-- G5-M1 manual finance: no bank transfer API, no auto receipt or refund.
-- All writes require operator release flag AND authenticated Owner/Manager.
-- Refund "manually_recorded" means staff checked an external bank outflow,
-- NOT provider verification; Order status/payment state remain untouched.
CREATE TABLE rcat.manual_payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  request_id uuid NOT NULL,
  order_id uuid NOT NULL,
  amount_satang bigint NOT NULL CHECK(amount_satang BETWEEN 1 AND 100000000),
  reason text NOT NULL CHECK(length(reason) BETWEEN 4 AND 240),
  state text NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','manually_recorded','voided')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 2147483646),
  requested_by uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES rcat.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  bank_reference_digest bytea
    CHECK(bank_reference_digest IS NULL OR octet_length(bank_reference_digest)=32),
  CHECK (
    (state='pending' AND decided_by IS NULL AND decided_at IS NULL
      AND bank_reference_digest IS NULL) OR
    (state='voided' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
      AND bank_reference_digest IS NULL) OR
    (state='manually_recorded' AND decided_by IS NOT NULL
      AND decided_at IS NOT NULL AND bank_reference_digest IS NOT NULL)
  ),
  UNIQUE(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id,request_id,order_id)
    REFERENCES rcat.payment_requests(tenant_id,store_id,id,order_id)
    ON DELETE RESTRICT
);
CREATE UNIQUE INDEX manual_payment_refund_bank_ref_unique
 ON rcat.manual_payment_refunds(tenant_id,store_id,bank_reference_digest)
 WHERE bank_reference_digest IS NOT NULL;
CREATE INDEX manual_payment_refund_order
 ON rcat.manual_payment_refunds(tenant_id,store_id,order_id)
 WHERE state<>'voided';
CREATE INDEX manual_payment_refund_period
 ON rcat.manual_payment_refunds(tenant_id,store_id,requested_at DESC);
ALTER TABLE rcat.manual_payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.manual_payment_refunds FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.manual_payment_refunds FROM PUBLIC,rcat_app,rcat_auth;

-- Unmatched/underpaid/late/duplicate deposits are manual exception reports:
-- never automatically allocate them to an Order or recognize settlement.
CREATE TABLE rcat.manual_payment_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  order_id uuid,
  kind text NOT NULL CHECK(kind IN (
    'underpayment','overpayment','duplicate_transfer','late_transfer',
    'cancelled_after_transfer','unmatched_transfer','other'
  )),
  amount_satang bigint CHECK(amount_satang IS NULL OR
    amount_satang BETWEEN 1 AND 100000000),
  note text NOT NULL CHECK(length(note) BETWEEN 4 AND 240),
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 2147483646),
  opened_by uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_by uuid REFERENCES rcat.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution text CHECK(resolution IS NULL OR length(resolution) BETWEEN 4 AND 240),
  CHECK((state='open' AND resolved_at IS NULL AND resolved_by IS NULL
    AND resolution IS NULL) OR
    (state='resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
    AND resolution IS NOT NULL)),
  UNIQUE(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id)
    REFERENCES rcat.stores(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,store_id,order_id)
    REFERENCES rcat.orders(tenant_id,store_id,id) ON DELETE RESTRICT
);
CREATE INDEX manual_payment_exception_queue
 ON rcat.manual_payment_exceptions(tenant_id,store_id,opened_at DESC)
 WHERE state='open';
ALTER TABLE rcat.manual_payment_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.manual_payment_exceptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.manual_payment_exceptions FROM PUBLIC,rcat_app,rcat_auth;

CREATE FUNCTION rcat_private.request_manual_payment_refund(
 p_session bytea,p_tenant uuid,p_store uuid,p_order uuid,
 p_amount bigint,p_reason text,p_release boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_order rcat.orders%ROWTYPE;
 v_request rcat.payment_requests%ROWTYPE;v_reserved bigint;v_id uuid;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
 IF p_release IS DISTINCT FROM true OR p_order IS NULL OR
    p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 100000000 OR
    p_reason IS NULL OR length(p_reason) NOT BETWEEN 4 AND 240 THEN
   RAISE EXCEPTION 'Manual refund unavailable' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_order FROM rcat.orders
  WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_order FOR UPDATE;
 IF NOT FOUND OR v_order.payment_state<>'manual_confirmed' THEN
   RAISE EXCEPTION 'No manually confirmed receipt for refund' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_request FROM rcat.payment_requests
  WHERE tenant_id=p_tenant AND store_id=p_store AND order_id=p_order
    AND state='manual_confirmed';
 IF NOT FOUND THEN
   RAISE EXCEPTION 'No confirmed Payment Request' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(sum(r.amount_satang),0) INTO v_reserved
 FROM rcat.manual_payment_refunds r
 WHERE r.tenant_id=p_tenant AND r.store_id=p_store AND
   r.order_id=p_order AND r.state<>'voided';
 IF v_reserved+p_amount>v_request.amount_satang THEN
   RAISE EXCEPTION 'Refund exceeds verified receipt remaining' USING ERRCODE='P0009';
 END IF;
 INSERT INTO rcat.manual_payment_refunds(
   tenant_id,store_id,request_id,order_id,amount_satang,reason,requested_by
 ) VALUES(
   p_tenant,p_store,v_request.id,p_order,p_amount,p_reason,v_actor
 ) RETURNING id INTO v_id;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
 VALUES(p_tenant,v_actor,'payment.refund.requested',p_order,
   jsonb_build_object('storeId',p_store,'refundId',v_id,'amountSatang',p_amount));
 RETURN jsonb_build_object('refundId',v_id,'orderId',p_order,
   'state','pending','revision',1,'amountSatang',p_amount);
END $$;

CREATE FUNCTION rcat_private.decide_manual_payment_refund(
 p_session bytea,p_tenant uuid,p_store uuid,p_refund uuid,
 p_revision integer,p_action text,p_bank_digest bytea,
 p_amount bigint,p_checked boolean,p_release boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_ref rcat.manual_payment_refunds%ROWTYPE;
 v_order rcat.orders%ROWTYPE;v_state text;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
 IF p_release IS DISTINCT FROM true OR p_refund IS NULL OR
   p_revision IS NULL OR p_revision<1 OR p_action NOT IN ('record','void') THEN
   RAISE EXCEPTION 'Invalid refund decision' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_ref FROM rcat.manual_payment_refunds
  WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_refund;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Refund not found' USING ERRCODE='42501';
 END IF;
 -- Serialize with another refund request for the same Order.
 SELECT * INTO v_order FROM rcat.orders
  WHERE tenant_id=p_tenant AND store_id=p_store AND id=v_ref.order_id FOR UPDATE;
 SELECT * INTO v_ref FROM rcat.manual_payment_refunds
  WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_refund FOR UPDATE;
 IF v_ref.state<>'pending' OR v_ref.revision<>p_revision THEN
   RAISE EXCEPTION 'Refund already decided' USING ERRCODE='P0009';
 END IF;
 IF p_action='record' THEN
   IF p_checked IS DISTINCT FROM true OR p_amount IS DISTINCT FROM v_ref.amount_satang
     OR p_bank_digest IS NULL OR octet_length(p_bank_digest)<>32 THEN
     RAISE EXCEPTION 'Bank outflow check required' USING ERRCODE='22023';
   END IF;
   v_state:='manually_recorded';
 ELSE
   IF p_bank_digest IS NOT NULL OR p_amount IS NOT NULL OR p_checked IS DISTINCT FROM false THEN
     RAISE EXCEPTION 'Invalid void decision' USING ERRCODE='22023';
   END IF;
   v_state:='voided';
 END IF;
 UPDATE rcat.manual_payment_refunds
 SET state=v_state,revision=revision+1,decided_by=v_actor,
     decided_at=clock_timestamp(),bank_reference_digest=p_bank_digest
 WHERE id=p_refund;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
 VALUES(p_tenant,v_actor,
   CASE WHEN v_state='manually_recorded'
     THEN 'payment.refund.manually_recorded' ELSE 'payment.refund.voided' END,
   v_ref.order_id,
   jsonb_build_object('storeId',p_store,'refundId',p_refund,
     'amountSatang',v_ref.amount_satang,'revision',p_revision+1));
 RETURN jsonb_build_object('refundId',p_refund,'orderId',v_ref.order_id,
   'state',v_state,'revision',p_revision+1);
END $$;

CREATE FUNCTION rcat_private.open_manual_payment_exception(
 p_session bytea,p_tenant uuid,p_store uuid,p_order uuid,p_kind text,
 p_amount bigint,p_note text,p_release boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_id uuid;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
 IF p_release IS DISTINCT FROM true OR p_kind IS NULL OR
   p_kind NOT IN ('underpayment','overpayment','duplicate_transfer',
     'late_transfer','cancelled_after_transfer','unmatched_transfer','other')
   OR p_note IS NULL OR length(p_note) NOT BETWEEN 4 AND 240 OR
   (p_amount IS NOT NULL AND p_amount NOT BETWEEN 1 AND 100000000) THEN
   RAISE EXCEPTION 'Invalid payment exception' USING ERRCODE='22023';
 END IF;
 IF p_order IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM rcat.orders WHERE tenant_id=p_tenant
    AND store_id=p_store AND id=p_order) THEN
   RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
 END IF;
 INSERT INTO rcat.manual_payment_exceptions(
  tenant_id,store_id,order_id,kind,amount_satang,note,opened_by
 ) VALUES (p_tenant,p_store,p_order,p_kind,p_amount,p_note,v_actor)
 RETURNING id INTO v_id;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
 VALUES(p_tenant,v_actor,'payment.exception.opened',coalesce(p_order,v_id),
  jsonb_build_object('storeId',p_store,'exceptionId',v_id,'kind',p_kind));
 RETURN jsonb_build_object('exceptionId',v_id,'state','open','revision',1);
END $$;

CREATE FUNCTION rcat_private.resolve_manual_payment_exception(
 p_session bytea,p_tenant uuid,p_store uuid,p_exception uuid,
 p_revision integer,p_resolution text,p_release boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_record rcat.manual_payment_exceptions%ROWTYPE;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
 IF p_release IS DISTINCT FROM true OR p_exception IS NULL OR
   p_revision IS NULL OR p_revision<1 OR
   p_resolution IS NULL OR length(p_resolution) NOT BETWEEN 4 AND 240 THEN
   RAISE EXCEPTION 'Invalid payment exception resolution' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_record FROM rcat.manual_payment_exceptions
 WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_exception FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Exception unavailable' USING ERRCODE='42501';
 END IF;
 IF v_record.state<>'open' OR v_record.revision<>p_revision THEN
   RAISE EXCEPTION 'Exception already resolved' USING ERRCODE='P0009';
 END IF;
 UPDATE rcat.manual_payment_exceptions SET
  state='resolved',revision=revision+1,resolution=p_resolution,
  resolved_at=clock_timestamp(),resolved_by=v_actor
 WHERE id=p_exception;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
 VALUES(p_tenant,v_actor,'payment.exception.resolved',
  coalesce(v_record.order_id,p_exception),
  jsonb_build_object('storeId',p_store,'exceptionId',p_exception,
    'revision',p_revision+1));
 RETURN jsonb_build_object('exceptionId',p_exception,
    'state','resolved','revision',p_revision+1);
END $$;

-- Amounts are decimal strings: never coerce potentially large SUM(bigint)
-- into a JS floating-point integer. This is a MANUAL register, not PSP.
-- Period event aggregates deliberately differ from Order-cohort metrics.
CREATE FUNCTION rcat_private.merchant_manual_payment_report(
 p_session bytea,p_tenant uuid,p_store uuid,p_days integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_since timestamptz;v_summary jsonb;
 v_orders jsonb;v_confirmed jsonb;v_refunds jsonb;v_exceptions jsonb;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
 IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 90 THEN
   RAISE EXCEPTION 'Invalid report window' USING ERRCODE='22023';
 END IF;
 v_since:=now()-make_interval(days=>p_days);
 SELECT jsonb_build_object(
   'orderCount',count(*),
   'orderTotalSatang',coalesce(sum(o.amount_satang),0)::text,
   'outstandingOrderCount',count(*) FILTER (
     WHERE o.status<>'cancelled' AND
       o.payment_state<>'manual_confirmed'),
   'outstandingSatang',coalesce(sum(o.amount_satang) FILTER (
     WHERE o.status<>'cancelled' AND
       o.payment_state<>'manual_confirmed'),0)::text,
   'submittedSlipCount',count(*) FILTER (
     WHERE o.payment_state='slip_submitted'),
   'cancelledConfirmedCount',count(*) FILTER (
     WHERE o.status='cancelled' AND
       o.payment_state='manual_confirmed')
 ) INTO v_summary
 FROM rcat.orders o
 WHERE o.tenant_id=p_tenant AND o.store_id=p_store
   AND o.created_at>=v_since;
 v_summary:=v_summary || jsonb_build_object(
   'manualReceiptSatang',(
     SELECT coalesce(sum(s.confirmed_amount_satang),0)::text
     FROM rcat.payment_slip_evidence s
     WHERE s.tenant_id=p_tenant AND s.store_id=p_store
       AND s.state='manual_confirmed' AND s.reviewed_at>=v_since
   ),
   'manualRefundRecordedSatang',(
     SELECT coalesce(sum(r.amount_satang),0)::text
     FROM rcat.manual_payment_refunds r
     WHERE r.tenant_id=p_tenant AND r.store_id=p_store
       AND r.state='manually_recorded' AND r.decided_at>=v_since
   ),
   'manualRefundPendingSatang',(
     SELECT coalesce(sum(r.amount_satang),0)::text
     FROM rcat.manual_payment_refunds r
     WHERE r.tenant_id=p_tenant AND r.store_id=p_store
       AND r.state='pending'
   ),
   'openExceptionCount',(
     SELECT count(*) FROM rcat.manual_payment_exceptions e
     WHERE e.tenant_id=p_tenant AND e.store_id=p_store
       AND e.state='open'
   )
 );
 SELECT coalesce(jsonb_agg(t.row_data ORDER BY t.created_at DESC),'[]'::jsonb)
 INTO v_orders FROM (
   SELECT o.created_at,jsonb_build_object(
     'orderId',o.id,'amountSatang',o.amount_satang,
     'status',o.status,'paymentState',o.payment_state,
     'createdAt',o.created_at) row_data
   FROM rcat.orders o WHERE o.tenant_id=p_tenant AND o.store_id=p_store
     AND o.status<>'cancelled' AND
       o.payment_state<>'manual_confirmed' AND o.created_at>=v_since
   ORDER BY o.created_at DESC,o.id DESC LIMIT 50
 ) t;
 SELECT coalesce(jsonb_agg(t.row_data ORDER BY t.created_at DESC),'[]'::jsonb)
 INTO v_confirmed FROM (
   SELECT o.created_at,jsonb_build_object(
     'orderId',o.id,'amountSatang',o.amount_satang,
     'status',o.status,'paymentState',o.payment_state,
     'createdAt',o.created_at) row_data
   FROM rcat.orders o WHERE o.tenant_id=p_tenant AND o.store_id=p_store
     AND o.payment_state='manual_confirmed' AND o.created_at>=v_since
   ORDER BY o.created_at DESC,o.id DESC LIMIT 50
 ) t;
 SELECT coalesce(jsonb_agg(t.row_data ORDER BY t.requested_at DESC),'[]'::jsonb)
 INTO v_refunds FROM (
  SELECT r.requested_at,jsonb_build_object(
    'refundId',r.id,'orderId',r.order_id,'amountSatang',r.amount_satang,
    'reason',r.reason,'state',r.state,'revision',r.revision,
    'requestedAt',r.requested_at,'decidedAt',r.decided_at) row_data
  FROM rcat.manual_payment_refunds r
  WHERE r.tenant_id=p_tenant AND r.store_id=p_store
    AND (r.requested_at>=v_since OR r.state='pending')
  ORDER BY r.requested_at DESC,r.id DESC LIMIT 50
 ) t;
 SELECT coalesce(jsonb_agg(t.row_data ORDER BY t.opened_at DESC),'[]'::jsonb)
 INTO v_exceptions FROM (
  SELECT e.opened_at,jsonb_build_object(
   'exceptionId',e.id,'orderId',e.order_id,'kind',e.kind,
   'amountSatang',e.amount_satang,'note',e.note,
   'state',e.state,'revision',e.revision,'openedAt',e.opened_at,
   'resolution',e.resolution) row_data
  FROM rcat.manual_payment_exceptions e
  WHERE e.tenant_id=p_tenant AND e.store_id=p_store
    AND (e.opened_at>=v_since OR e.state='open')
  ORDER BY e.opened_at DESC,e.id DESC LIMIT 50
 ) t;
 RETURN jsonb_build_object(
   'windowDays',p_days,'generatedAt',now(),
   'summary',v_summary,'outstandingOrders',v_orders,
   'confirmedOrders',v_confirmed,
   'refunds',v_refunds,'exceptions',v_exceptions,
   'verification','merchant_manual_only',
   'note','No bank/provider verification; totals describe different event cohorts'
 );
END $$;

REVOKE ALL ON FUNCTION rcat_private.request_manual_payment_refund(
 bytea,uuid,uuid,uuid,bigint,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.decide_manual_payment_refund(
 bytea,uuid,uuid,uuid,integer,text,bytea,bigint,boolean,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.open_manual_payment_exception(
 bytea,uuid,uuid,uuid,text,bigint,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.resolve_manual_payment_exception(
 bytea,uuid,uuid,uuid,integer,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.merchant_manual_payment_report(
 bytea,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.request_manual_payment_refund(
 bytea,uuid,uuid,uuid,bigint,text,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.decide_manual_payment_refund(
 bytea,uuid,uuid,uuid,integer,text,bytea,bigint,boolean,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.open_manual_payment_exception(
 bytea,uuid,uuid,uuid,text,bigint,text,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.resolve_manual_payment_exception(
 bytea,uuid,uuid,uuid,integer,text,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_manual_payment_report(
 bytea,uuid,uuid,integer) TO rcat_auth;
