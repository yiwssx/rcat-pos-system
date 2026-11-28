-- Private, Order-scoped recovery after a merchant has reviewed outstanding
-- payment. One current grant per Order; no raw credentials, public table-QR
-- authority, payment/fulfilment transition or changes to existing bearers.
CREATE TABLE rcat_private.order_payment_recovery (
  order_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  amount_satang bigint NOT NULL CHECK(amount_satang BETWEEN 1 AND 100000000),
  claim_digest bytea NOT NULL UNIQUE CHECK(octet_length(claim_digest)=32),
  claim_expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  access_digest bytea UNIQUE CHECK(access_digest IS NULL OR octet_length(access_digest)=32),
  redeemed_at timestamptz,
  access_expires_at timestamptz,
  CHECK(claim_expires_at=issued_at+interval '30 minutes'),
  CHECK((access_digest IS NULL AND redeemed_at IS NULL AND access_expires_at IS NULL)
    OR (access_digest IS NOT NULL AND redeemed_at IS NOT NULL
      AND access_expires_at=redeemed_at+interval '12 hours'
      AND redeemed_at>=issued_at AND redeemed_at<claim_expires_at)),
  FOREIGN KEY(tenant_id,store_id,order_id)
    REFERENCES rcat.orders(tenant_id,store_id,id) ON DELETE RESTRICT
);
ALTER TABLE rcat_private.order_payment_recovery ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat_private.order_payment_recovery FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat_private.order_payment_recovery FROM PUBLIC,rcat_app,rcat_auth;

CREATE FUNCTION rcat_private.merchant_issue_order_payment_recovery(
  p_session bytea,p_tenant uuid,p_store uuid,p_order uuid,
  p_expected_state text,p_expected_amount bigint,p_reviewed boolean,
  p_claim_digest bytea,p_release_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid; v_order rcat.orders%ROWTYPE;
 v_receiver rcat.store_promptpay_receivers%ROWTYPE;
 v_request rcat.payment_requests%ROWTYPE; v_now timestamptz;
BEGIN
  v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
  IF p_reviewed IS DISTINCT FROM true OR p_expected_state IS NULL OR
    p_expected_state NOT IN ('not_requested','awaiting_payment') OR
    p_expected_amount IS NULL OR p_expected_amount NOT BETWEEN 1 AND 100000000 OR
    p_claim_digest IS NULL OR octet_length(p_claim_digest)<>32 THEN
    RAISE EXCEPTION 'Explicit outstanding payment review required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_order FROM rcat.orders
   WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order recovery unavailable' USING ERRCODE='42501';
  END IF;
  IF p_release_enabled IS DISTINCT FROM true OR v_order.status='cancelled' OR
     v_order.payment_state<>p_expected_state OR v_order.amount_satang<>p_expected_amount THEN
    RAISE EXCEPTION 'Order or payment availability changed' USING ERRCODE='P0009';
  END IF;
  SELECT * INTO v_receiver FROM rcat.store_promptpay_receivers
    WHERE tenant_id=p_tenant AND store_id=p_store AND enabled=true FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment unavailable' USING ERRCODE='P0009';
  END IF;
  SELECT * INTO v_request FROM rcat.payment_requests
    WHERE tenant_id=p_tenant AND store_id=p_store AND order_id=p_order;
  IF (FOUND AND (v_order.payment_state<>'awaiting_payment' OR
      v_request.state<>'awaiting_payment' OR
      v_request.amount_satang<>v_order.amount_satang OR
      v_request.currency<>v_order.currency OR
      v_request.recipient_kind<>v_receiver.recipient_kind OR
      v_request.recipient_identifier<>v_receiver.recipient_identifier))
    OR (NOT FOUND AND v_order.payment_state<>'not_requested') THEN
    RAISE EXCEPTION 'Payment snapshot requires reconciliation' USING ERRCODE='P0009';
  END IF;
  v_now:=clock_timestamp();
  -- Issuing/reissuing never creates a Payment Request or changes an Order.
  -- Replaces any prior recovery only, not the original tracking digest.
  INSERT INTO rcat_private.order_payment_recovery(
    order_id,tenant_id,store_id,amount_satang,claim_digest,claim_expires_at,issued_at)
  VALUES(p_order,p_tenant,p_store,v_order.amount_satang,p_claim_digest,
    v_now+interval '30 minutes',v_now)
  ON CONFLICT(order_id) DO UPDATE SET
    amount_satang=EXCLUDED.amount_satang,claim_digest=EXCLUDED.claim_digest,
    claim_expires_at=EXCLUDED.claim_expires_at,issued_at=EXCLUDED.issued_at,
    access_digest=NULL,redeemed_at=NULL,access_expires_at=NULL;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
    VALUES(p_tenant,v_actor,'payment.recovery.issued',p_order,
      jsonb_build_object('storeId',p_store,'paymentState',v_order.payment_state,
        'amountSatang',v_order.amount_satang,'reviewed',true));
  RETURN jsonb_build_object('orderId',p_order,'displayNumber',v_order.display_number::text,
    'claimExpiresAt',v_now+interval '30 minutes');
END $$;

CREATE FUNCTION rcat_private.merchant_revoke_order_payment_recovery(
  p_session bytea,p_tenant uuid,p_store uuid,p_order uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
  PERFORM 1 FROM rcat.orders WHERE tenant_id=p_tenant AND store_id=p_store
    AND id=p_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order recovery unavailable' USING ERRCODE='42501';
  END IF;
  DELETE FROM rcat_private.order_payment_recovery
    WHERE tenant_id=p_tenant AND store_id=p_store AND order_id=p_order;
  IF FOUND THEN
    INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
      VALUES(p_tenant,v_actor,'payment.recovery.revoked',p_order,
        jsonb_build_object('storeId',p_store));
  END IF;
  RETURN jsonb_build_object('orderId',p_order,'revoked',true);
END $$;

CREATE FUNCTION rcat_private.guest_redeem_order_payment_recovery(
  p_order uuid,p_claim_digest bytea,p_access_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_order rcat.orders%ROWTYPE; v_grant rcat_private.order_payment_recovery%ROWTYPE;
 v_now timestamptz;
BEGIN
  IF p_order IS NULL OR p_claim_digest IS NULL OR p_access_digest IS NULL OR
    octet_length(p_claim_digest)<>32 OR octet_length(p_access_digest)<>32 OR
    p_claim_digest=p_access_digest THEN
    RAISE EXCEPTION 'Order recovery unavailable' USING ERRCODE='42501';
  END IF;
  -- Match the high-entropy claim before locking any Order. Re-read grant
  -- after acquiring Order lock, matching issue/revoke/payment lock order.
  IF NOT EXISTS(SELECT 1 FROM rcat_private.order_payment_recovery
     WHERE order_id=p_order AND claim_digest=p_claim_digest
       AND claim_expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Order recovery unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_order FROM rcat.orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order recovery unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_grant FROM rcat_private.order_payment_recovery
    WHERE order_id=p_order AND claim_digest=p_claim_digest FOR UPDATE;
  v_now:=clock_timestamp();
  IF NOT FOUND OR v_grant.claim_expires_at<=v_now OR
    v_grant.amount_satang<>v_order.amount_satang OR
    (v_grant.access_digest IS NOT NULL AND v_grant.access_digest<>p_access_digest) THEN
    RAISE EXCEPTION 'Order recovery unavailable' USING ERRCODE='42501';
  END IF;
  IF v_grant.access_digest IS NULL THEN
    UPDATE rcat_private.order_payment_recovery
      SET access_digest=p_access_digest,redeemed_at=v_now,
        access_expires_at=v_now+interval '12 hours'
      WHERE order_id=p_order RETURNING * INTO v_grant;
    INSERT INTO rcat.audit_events(tenant_id,action,subject_id,metadata)
      VALUES(v_order.tenant_id,'payment.recovery.redeemed',p_order,
        jsonb_build_object('storeId',v_order.store_id));
  END IF;
  -- A lost response can be retried only by the same browser-generated access
  -- secret during the claim window; a second device cannot redeem it.
  RETURN jsonb_build_object('orderId',p_order,'displayNumber',v_order.display_number::text,
    'expiresAt',v_grant.access_expires_at);
END $$;

-- Internal only. Original bearers retain their existing semantics; a
-- recovered bearer is independent, scoped, expiring and revocable. An
-- Order amount change invalidates it until explicitly reissued by the shop.
CREATE FUNCTION rcat_private._guest_order_tracking_allowed(
  p_order uuid,p_digest bytea,p_original bytea,p_amount bigint
) RETURNS boolean LANGUAGE sql SET search_path=pg_catalog
AS $$
  SELECT coalesce(p_original=p_digest,false) OR EXISTS(
    SELECT 1 FROM rcat_private.order_payment_recovery
    WHERE order_id=p_order AND access_digest=p_digest
      AND access_expires_at>clock_timestamp() AND amount_satang=p_amount
  )
$$;
REVOKE ALL ON FUNCTION rcat_private._guest_order_tracking_allowed(uuid,bytea,bytea,bigint)
  FROM PUBLIC,rcat_app,rcat_auth;
REVOKE ALL ON FUNCTION rcat_private.merchant_issue_order_payment_recovery(bytea,uuid,uuid,uuid,text,bigint,boolean,bytea,boolean)
  FROM PUBLIC,rcat_app;
REVOKE ALL ON FUNCTION rcat_private.merchant_revoke_order_payment_recovery(bytea,uuid,uuid,uuid)
  FROM PUBLIC,rcat_app;
REVOKE ALL ON FUNCTION rcat_private.guest_redeem_order_payment_recovery(uuid,bytea,bytea)
  FROM PUBLIC,rcat_app;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_issue_order_payment_recovery(bytea,uuid,uuid,uuid,text,bigint,boolean,bytea,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_revoke_order_payment_recovery(bytea,uuid,uuid,uuid) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.guest_redeem_order_payment_recovery(uuid,bytea,bytea) TO rcat_auth;

-- Preserve the previously reviewed function bodies, changing only the tracking
-- predicate (plus rechecking it after the Order lock for mutation paths).

CREATE OR REPLACE FUNCTION rcat_private.guest_order_status(
  p_order_id uuid, p_tracking_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_order rcat.orders%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR p_tracking_digest IS NULL
    OR octet_length(p_tracking_digest)<>32
  THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_order
  FROM rcat.orders
  WHERE id=p_order_id AND rcat_private._guest_order_tracking_allowed(
      id,p_tracking_digest,tracking_token_digest,amount_satang);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;

  RETURN jsonb_build_object(
    'orderId',v_order.id,'displayNumber',v_order.display_number::text,'status',v_order.status,
    'paymentState',v_order.payment_state,
    'amountSatang',v_order.amount_satang,
    'currency',v_order.currency,
    'createdAt',v_order.created_at,
    'updatedAt',v_order.updated_at
  );
END $$;

CREATE OR REPLACE FUNCTION rcat_private.guest_order_history(
  p_order_id uuid,p_tracking_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_tenant uuid;v_store uuid;
BEGIN
  IF p_order_id IS NULL OR p_tracking_digest IS NULL
    OR octet_length(p_tracking_digest)<>32 THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;
  SELECT tenant_id,store_id INTO v_tenant,v_store
  FROM rcat.orders
  WHERE id=p_order_id AND rcat_private._guest_order_tracking_allowed(
      id,p_tracking_digest,tracking_token_digest,amount_satang);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;
  RETURN rcat_private._order_status_timeline(
    v_tenant,v_store,p_order_id,false);
END $$;

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
  WHERE id=p_order_id AND rcat_private._guest_order_tracking_allowed(
      id,p_tracking_digest,tracking_token_digest,amount_satang)
  FOR UPDATE;
  IF NOT FOUND OR NOT rcat_private._guest_order_tracking_allowed(
    v_order.id,p_tracking_digest,v_order.tracking_token_digest,v_order.amount_satang) THEN
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

CREATE OR REPLACE FUNCTION rcat_private.guest_submit_payment_slip(
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
   WHERE id=p_order AND rcat_private._guest_order_tracking_allowed(
      id,p_tracking_digest,tracking_token_digest,amount_satang) FOR UPDATE;
  IF NOT FOUND OR NOT rcat_private._guest_order_tracking_allowed(
    v_order.id,p_tracking_digest,v_order.tracking_token_digest,v_order.amount_satang) THEN
    RAISE EXCEPTION 'Payment evidence unavailable' USING ERRCODE='42501';
  END IF;
  IF p_release_enabled IS DISTINCT FROM true OR
     v_order.status='cancelled' THEN
    RAISE EXCEPTION 'Payment evidence disabled' USING ERRCODE='42501';
  END IF;
  IF p_png IS NULL OR octet_length(p_png) NOT BETWEEN 80 AND 524288 OR
     p_sha IS NULL OR octet_length(p_sha)<>32 OR
     sha256(p_png)<>p_sha OR
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
