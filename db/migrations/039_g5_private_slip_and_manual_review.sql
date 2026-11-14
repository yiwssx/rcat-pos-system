-- G5-M1 draft: private PNG slip evidence and manually controlled decision.
-- DORMANT at deployment: API env release flag OFF and receiver.enabled FALSE.
-- Existing order kitchen transitions stay independent of these payment states.
ALTER TABLE rcat.orders DROP CONSTRAINT orders_payment_state_check;
ALTER TABLE rcat.orders ADD CONSTRAINT orders_payment_state_check
  CHECK(payment_state IN ('not_requested','awaiting_payment',
    'slip_submitted','manual_confirmed'));

ALTER TABLE rcat.payment_requests DROP CONSTRAINT payment_requests_state_check;
ALTER TABLE rcat.payment_requests ADD CONSTRAINT payment_requests_state_check
  CHECK(state IN ('awaiting_payment','slip_submitted','manual_confirmed'));

CREATE TABLE rcat.payment_slip_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  request_id uuid NOT NULL,
  order_id uuid NOT NULL,
  png bytea NOT NULL CHECK(octet_length(png) BETWEEN 80 AND 524288),
  sha256 bytea NOT NULL CHECK(octet_length(sha256)=32),
  state text NOT NULL DEFAULT 'submitted'
    CHECK(state IN ('submitted','rejected','manual_confirmed')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES rcat.users(id) ON DELETE SET NULL,
  bank_reference_digest bytea
    CHECK(bank_reference_digest IS NULL OR octet_length(bank_reference_digest)=32),
  confirmed_amount_satang bigint
    CHECK(confirmed_amount_satang IS NULL OR
      confirmed_amount_satang BETWEEN 1 AND 100000000),
  CHECK (
    (state='manual_confirmed' AND reviewed_at IS NOT NULL
      AND reviewed_by IS NOT NULL AND bank_reference_digest IS NOT NULL
      AND confirmed_amount_satang IS NOT NULL) OR
    (state='rejected' AND reviewed_at IS NOT NULL
      AND reviewed_by IS NOT NULL AND bank_reference_digest IS NULL
      AND confirmed_amount_satang IS NULL) OR
    (state='submitted' AND reviewed_at IS NULL AND reviewed_by IS NULL
      AND bank_reference_digest IS NULL AND confirmed_amount_satang IS NULL)
  ),
  UNIQUE(tenant_id,store_id,sha256),
  FOREIGN KEY(tenant_id,store_id,request_id)
    REFERENCES rcat.payment_requests(tenant_id,store_id,id)
    ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,store_id,order_id)
    REFERENCES rcat.orders(tenant_id,store_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX payment_slip_bank_ref_unique_idx
 ON rcat.payment_slip_evidence(tenant_id,store_id,bank_reference_digest)
 WHERE bank_reference_digest IS NOT NULL;
CREATE INDEX payment_slips_review_queue_idx
 ON rcat.payment_slip_evidence(tenant_id,store_id,submitted_at DESC)
 WHERE state='submitted';
ALTER TABLE rcat.payment_slip_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.payment_slip_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.payment_slip_evidence FROM PUBLIC,rcat_app,rcat_auth;

-- The SQL layer independently validates the tracking capability and release
-- flag; a raw Order UUID, visit token or client amount is NEVER authority.
CREATE FUNCTION rcat_private.guest_submit_payment_slip(
  p_order uuid,p_tracking_digest bytea,p_png bytea,p_sha bytea,
  p_release_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_order rcat.orders%ROWTYPE;
  v_payment rcat.payment_requests%ROWTYPE;
  v_last rcat.payment_slip_evidence%ROWTYPE;
  v_slip uuid;
BEGIN
  IF p_tracking_digest IS NULL OR octet_length(p_tracking_digest)<>32
    OR p_order IS NULL THEN
    RAISE EXCEPTION 'Payment evidence unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_order FROM rcat.orders
   WHERE id=p_order AND tracking_token_digest=p_tracking_digest FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment evidence unavailable' USING ERRCODE='42501';
  END IF;
  IF p_release_enabled IS DISTINCT FROM true OR
     v_order.status='cancelled' THEN
    RAISE EXCEPTION 'Payment evidence disabled' USING ERRCODE='42501';
  END IF;
  IF p_png IS NULL OR octet_length(p_png) NOT BETWEEN 80 AND 524288 OR
     p_sha IS NULL OR octet_length(p_sha)<>32 OR
     digest(p_png,'sha256')<>p_sha OR
     substring(p_png from 1 for 8)<>decode('89504e470d0a1a0a','hex') THEN
    RAISE EXCEPTION 'Invalid payment evidence' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_payment FROM rcat.payment_requests
   WHERE tenant_id=v_order.tenant_id AND store_id=v_order.store_id
     AND order_id=v_order.id FOR UPDATE;
  IF NOT FOUND OR v_payment.state='manual_confirmed' THEN
    RAISE EXCEPTION 'Payment request unavailable' USING ERRCODE='42501';
  END IF;
  -- A receiver rotation shuts down new QR display but old bank transfers
  -- can still be submitted for manual reconciliation with its snapshot.
  PERFORM 1 FROM rcat.store_promptpay_receivers
    WHERE tenant_id=v_order.tenant_id AND store_id=v_order.store_id
      AND enabled=true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment evidence disabled' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_last FROM rcat.payment_slip_evidence
   WHERE tenant_id=v_order.tenant_id AND store_id=v_order.store_id
     AND request_id=v_payment.id
   ORDER BY submitted_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND v_last.sha256=p_sha THEN
    RETURN jsonb_build_object('slipId',v_last.id,'state',v_last.state,
      'revision',v_last.revision,'replayed',true);
  END IF;
  IF v_payment.state<>'awaiting_payment' THEN
    RAISE EXCEPTION 'Slip awaiting review' USING ERRCODE='P0009';
  END IF;
  IF (SELECT count(*) FROM rcat.payment_slip_evidence
      WHERE tenant_id=v_order.tenant_id AND store_id=v_order.store_id
        AND request_id=v_payment.id)>=3 THEN
    RAISE EXCEPTION 'Slip attempt limit reached' USING ERRCODE='P0009';
  END IF;
  -- Unique store-scope digest blocks recycling the same slip for another
  -- Order. Uploaded image does not prove settlement.
  INSERT INTO rcat.payment_slip_evidence(
    tenant_id,store_id,request_id,order_id,png,sha256
  ) VALUES(v_order.tenant_id,v_order.store_id,v_payment.id,
    v_order.id,p_png,p_sha)
  RETURNING id INTO v_slip;
  UPDATE rcat.payment_requests SET state='slip_submitted'
   WHERE id=v_payment.id;
  UPDATE rcat.orders SET payment_state='slip_submitted'
   WHERE id=v_order.id;
  INSERT INTO rcat.audit_events(tenant_id,action,subject_id,metadata)
  VALUES(v_order.tenant_id,'payment.slip.submitted',v_order.id,
    jsonb_build_object('storeId',v_order.store_id,'slipId',v_slip,
      'bytes',octet_length(p_png)));
  RETURN jsonb_build_object('slipId',v_slip,'state','submitted',
    'revision',1,'replayed',false);
END $$;

CREATE FUNCTION rcat_private.merchant_payment_review_queue(
  p_session bytea,p_tenant uuid,p_store uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_rows jsonb;
BEGIN
  v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid review limit' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(row_data ORDER BY submitted_at DESC),'[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT s.submitted_at,
      jsonb_build_object(
        'slipId',s.id,'orderId',s.order_id,
        'amountSatang',p.amount_satang,'currency',p.currency,
        'revision',s.revision,'submittedAt',s.submitted_at,
        'state',s.state
      ) row_data
    FROM rcat.payment_slip_evidence s
    JOIN rcat.payment_requests p ON p.id=s.request_id
      AND p.tenant_id=s.tenant_id AND p.store_id=s.store_id
    WHERE s.tenant_id=p_tenant AND s.store_id=p_store
      AND s.state='submitted'
    ORDER BY s.submitted_at DESC LIMIT p_limit
  ) q;
  RETURN jsonb_build_object('items',v_rows);
END $$;

CREATE FUNCTION rcat_private.merchant_payment_slip_png(
  p_session bytea,p_tenant uuid,p_store uuid,p_slip uuid
) RETURNS TABLE(png bytea,digest_sha256 bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  PERFORM rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
  RETURN QUERY SELECT s.png,s.sha256
    FROM rcat.payment_slip_evidence s
    WHERE s.tenant_id=p_tenant AND s.store_id=p_store AND s.id=p_slip;
END $$;

CREATE FUNCTION rcat_private.merchant_payment_slip_decision(
  p_session bytea,p_tenant uuid,p_store uuid,p_slip uuid,
  p_expected_revision integer,p_action text,p_bank_reference_digest bytea,
  p_actual_satang bigint,p_checked_bank boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
 v_actor uuid;v_slip rcat.payment_slip_evidence%ROWTYPE;
 v_order rcat.orders%ROWTYPE;v_payment rcat.payment_requests%ROWTYPE;
BEGIN
  v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
  IF p_slip IS NULL OR p_expected_revision IS NULL OR
    p_expected_revision<1 OR p_action NOT IN ('confirm','reject') THEN
    RAISE EXCEPTION 'Invalid review decision' USING ERRCODE='22023';
  END IF;
  -- Lock in the same order as guest submission: Order -> Request -> Slip.
  SELECT * INTO v_slip FROM rcat.payment_slip_evidence
   WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_slip;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slip unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_order FROM rcat.orders
   WHERE tenant_id=p_tenant AND store_id=p_store
      AND id=v_slip.order_id FOR UPDATE;
  SELECT * INTO v_payment FROM rcat.payment_requests
   WHERE tenant_id=p_tenant AND store_id=p_store
     AND id=v_slip.request_id FOR UPDATE;
  SELECT * INTO v_slip FROM rcat.payment_slip_evidence
   WHERE tenant_id=p_tenant AND store_id=p_store
     AND id=p_slip FOR UPDATE;
  IF v_slip.state<>'submitted' OR
    v_slip.revision<>p_expected_revision OR
    v_payment.state<>'slip_submitted' THEN
    RAISE EXCEPTION 'Review revision conflict' USING ERRCODE='P0009';
  END IF;
  IF p_action='confirm' THEN
    IF p_checked_bank IS DISTINCT FROM true OR
      p_actual_satang IS DISTINCT FROM v_payment.amount_satang OR
      p_bank_reference_digest IS NULL OR
      octet_length(p_bank_reference_digest)<>32 THEN
      RAISE EXCEPTION 'Bank check and exact amount required'
      USING ERRCODE='22023';
    END IF;
    UPDATE rcat.payment_slip_evidence SET
      state='manual_confirmed',revision=revision+1,
      reviewed_at=clock_timestamp(),reviewed_by=v_actor,
      bank_reference_digest=p_bank_reference_digest,
      confirmed_amount_satang=p_actual_satang
    WHERE id=v_slip.id;
    UPDATE rcat.payment_requests SET state='manual_confirmed'
      WHERE id=v_payment.id;
    UPDATE rcat.orders SET payment_state='manual_confirmed'
      WHERE id=v_order.id;
  ELSE
    UPDATE rcat.payment_slip_evidence SET
      state='rejected',revision=revision+1,
      reviewed_at=clock_timestamp(),reviewed_by=v_actor
    WHERE id=v_slip.id;
    UPDATE rcat.payment_requests SET state='awaiting_payment'
      WHERE id=v_payment.id;
    UPDATE rcat.orders SET payment_state='awaiting_payment'
      WHERE id=v_order.id;
  END IF;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata
  ) VALUES(
    p_tenant,v_actor,
    CASE WHEN p_action='confirm' THEN 'payment.slip.manual_confirmed'
         ELSE 'payment.slip.rejected' END,
    v_order.id,
    jsonb_build_object('storeId',p_store,'slipId',v_slip.id,
      'revision',p_expected_revision+1,
      'bankChecked',p_action='confirm')
  );
  RETURN jsonb_build_object('slipId',v_slip.id,
    'orderId',v_order.id,'revision',p_expected_revision+1,
    'state',CASE WHEN p_action='confirm'
     THEN 'manual_confirmed' ELSE 'rejected' END,
    'paymentState',CASE WHEN p_action='confirm'
     THEN 'manual_confirmed' ELSE 'awaiting_payment' END);
END $$;

REVOKE ALL ON FUNCTION rcat_private.guest_submit_payment_slip(
 uuid,bytea,bytea,bytea,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.merchant_payment_review_queue(
 bytea,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.merchant_payment_slip_png(
 bytea,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.merchant_payment_slip_decision(
 bytea,uuid,uuid,uuid,integer,text,bytea,bigint,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.guest_submit_payment_slip(
 uuid,bytea,bytea,bytea,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_payment_review_queue(
 bytea,uuid,uuid,integer) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_payment_slip_png(
 bytea,uuid,uuid,uuid) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_payment_slip_decision(
 bytea,uuid,uuid,uuid,integer,text,bytea,bigint,boolean) TO rcat_auth;

-- When a slip is waiting or manually confirmed, never show a payable QR.
-- This also fixes the stale receiver after rotation / re-enable hazard.
CREATE OR REPLACE FUNCTION rcat_private.guest_order_payment_request(
  p_order_id uuid,p_tracking_digest bytea,p_release_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_order rcat.orders%ROWTYPE;
  v_request rcat.payment_requests%ROWTYPE;
  v_receiver rcat.store_promptpay_receivers%ROWTYPE;
BEGIN
  -- A public Order UUID, table/visit token or merchant role is NOT sufficient.
  IF p_order_id IS NULL OR p_tracking_digest IS NULL OR
     octet_length(p_tracking_digest)<>32 THEN
    RAISE EXCEPTION 'Payment request unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_order FROM rcat.orders
  WHERE id=p_order_id AND tracking_token_digest=p_tracking_digest
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request unavailable' USING ERRCODE='42501';
  END IF;

  -- The API's rollout opt-in must be affirmative. This check comes AFTER
  -- capability authorization to avoid Order enumeration via flag changes.
  -- No new payment is created for cancelled/zero-value Orders.
  IF p_release_enabled IS DISTINCT FROM true OR
     v_order.status='cancelled' OR v_order.amount_satang<1 THEN
    RETURN jsonb_build_object('available',false);
  END IF;

  -- Disabling the receiver stops exposing EVEN prior Payment QR data,
  -- pending explicit G6 operator policy for outstanding liabilities.
  -- It also prevents a stale recipient change from redirecting old debt.
  SELECT * INTO v_receiver
  FROM rcat.store_promptpay_receivers
  WHERE tenant_id=v_order.tenant_id AND store_id=v_order.store_id
    AND enabled=true
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('available',false);
  END IF;

  SELECT * INTO v_request FROM rcat.payment_requests
  WHERE tenant_id=v_order.tenant_id AND store_id=v_order.store_id
    AND order_id=v_order.id;
  IF NOT FOUND THEN
    -- No client-provided amount or receiver is accepted. The row lock on
    -- the Order serializes retries and preserves the first receiver snapshot.
    INSERT INTO rcat.payment_requests(
      tenant_id,store_id,order_id,amount_satang,currency,
      recipient_kind,recipient_identifier
    ) VALUES (
      v_order.tenant_id,v_order.store_id,v_order.id,
      v_order.amount_satang,v_order.currency,
      v_receiver.recipient_kind,v_receiver.recipient_identifier
    )
    RETURNING * INTO v_request;
  END IF;
  -- An old unpaid request can no longer display its previous recipient
  -- after the owner changes the shop receiver. Keep the immutable snapshot
  -- for staff reconciliation without inviting further transfers.
  IF v_request.recipient_identifier<>v_receiver.recipient_identifier OR
     v_request.recipient_kind<>v_receiver.recipient_kind OR
     v_request.state<>'awaiting_payment' THEN
    RETURN jsonb_build_object('available',false);
  END IF;
  IF v_request.amount_satang<>v_order.amount_satang OR
     v_request.currency<>v_order.currency THEN
    RAISE EXCEPTION 'Payment snapshot mismatch' USING ERRCODE='P0009';
  END IF;

  -- Payment is separate from fulfilment. No Order status or stock changes.
  UPDATE rcat.orders SET payment_state='awaiting_payment'
  WHERE id=v_order.id AND payment_state='not_requested';

  RETURN jsonb_build_object(
    'available',true,'requestId',v_request.id,'orderId',v_order.id,
    'amountSatang',v_request.amount_satang,'currency',v_request.currency,
    'state',v_request.state,'receiverKind',v_request.recipient_kind,
    'receiverId',v_request.recipient_identifier,
    'createdAt',v_request.created_at
  );
END $$;

REVOKE ALL ON FUNCTION rcat_private.guest_order_payment_request(
  uuid,bytea,boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.guest_order_payment_request(
  uuid,bytea,boolean
) TO rcat_auth;
