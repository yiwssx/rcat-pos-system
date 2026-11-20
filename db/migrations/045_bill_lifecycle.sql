-- Issue #102 / B3: operational Table Bill lifecycle, independent of Payment.
-- Compatibility: no old migration is rewritten; old Order amounts/statuses
-- remain immutable; legacy data with multiple open Bills per table MUST be
-- manually reconciled rather than silently pretending a Bill was closed.
ALTER TABLE rcat.bills
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN creation_source text NOT NULL DEFAULT 'merchant'
    CHECK(creation_source IN ('merchant','guest_order')),
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by uuid REFERENCES rcat.users(id) ON DELETE RESTRICT,
  ADD COLUMN close_reason text
    CHECK(close_reason IS NULL OR close_reason='merchant'),
  ADD CONSTRAINT bills_creation_actor_contract CHECK(
    (creation_source='merchant' AND created_by IS NOT NULL) OR
    (creation_source='guest_order' AND created_by IS NULL)
  ),
  ADD CONSTRAINT bills_close_actor_contract CHECK(
    (closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL) OR
    (closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_reason='merchant')
  );

-- No forced archival of legacy Bills. Halt migration for operator review if
-- the existing data cannot satisfy the one-active-Bill business invariant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM rcat.bills
    GROUP BY tenant_id,store_id,table_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION
      'B3 migration blocked: multiple legacy Bills for a table require explicit owner reconciliation'
      USING ERRCODE='P0043';
  END IF;
END $$;
CREATE UNIQUE INDEX bills_one_active_per_table_idx ON rcat.bills(
  tenant_id,store_id,table_id
) WHERE closed_at IS NULL;

ALTER TABLE rcat.table_guest_grants
  ADD COLUMN revoked_at timestamptz;

-- A current Bill prohibits implicit and explicit creation of another Table
-- Visit (static QR scan expiry, staff rotation, staff code issuance). Closing
-- a Bill revokes its visit first, allowing a later fresh scan of the SAME QR.
CREATE FUNCTION rcat_private.block_new_visit_when_bill_open()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM rcat.bills b WHERE b.tenant_id=NEW.tenant_id
      AND b.store_id=NEW.store_id AND b.table_id=NEW.table_id
      AND b.closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Previous table Bill must be closed first'
      USING ERRCODE='P0043';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER table_bill_visit_cycle_gate
  BEFORE INSERT ON rcat.table_ordering_visits
  FOR EACH ROW EXECUTE FUNCTION rcat_private.block_new_visit_when_bill_open();
REVOKE ALL ON FUNCTION rcat_private.block_new_visit_when_bill_open() FROM PUBLIC;

-- Guest checkout holds the store's FOR UPDATE lock through creation of the
-- first Order and its Bill, so two devices never mint separate active Bills.
-- A QR scan alone never opens a Bill. created_by=NULL means SYSTEM on a
-- genuinely created Guest Order; it MUST NOT impersonate an employee.
CREATE FUNCTION rcat_private._ensure_table_bill_for_visit(
  p_tenant uuid,p_store uuid,p_table uuid,p_visit uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_bill uuid;v_other uuid;
BEGIN
  SELECT id,visit_id INTO v_bill,v_other FROM rcat.bills
  WHERE tenant_id=p_tenant AND store_id=p_store AND table_id=p_table
    AND closed_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF v_other<>p_visit THEN
      RAISE EXCEPTION 'Previous table Bill must be closed first'
        USING ERRCODE='P0043';
    END IF;
    RETURN v_bill;
  END IF;
  IF EXISTS(SELECT 1 FROM rcat.bills
    WHERE visit_id=p_visit AND closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Closed table Bill cannot be reopened'
      USING ERRCODE='P0043';
  END IF;
  INSERT INTO rcat.bills(
    tenant_id,store_id,table_id,visit_id,created_by,creation_source
  ) VALUES(
    p_tenant,p_store,p_table,p_visit,NULL,'guest_order'
  ) RETURNING id INTO v_bill;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata
  ) VALUES(
    p_tenant,NULL,'bill.operational.auto_opened',v_bill,
    jsonb_build_object('storeId',p_store,'visitId',p_visit,
      'source','guest_order','paymentVerified',false)
  );
  RETURN v_bill;
END $$;
REVOKE ALL ON FUNCTION rcat_private._ensure_table_bill_for_visit(
  uuid,uuid,uuid,uuid
) FROM PUBLIC;

-- Authorized Merchant/Staff action ONLY. The same store row lock also
-- serializes checkout, Guest QR entry, and create Bill. Closing idempotently
-- invalidates current Visit and per-device grants. No paid/refunded state.
CREATE FUNCTION rcat_private.close_operational_bill(
  p_digest bytea,p_tenant uuid,p_store uuid,p_bill uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;v_table uuid;v_visit uuid;
  v_closed timestamptz;v_now timestamptz;
BEGIN
  SELECT actor_id,staff_role INTO v_actor,v_role
  FROM rcat_private._order_staff_actor(p_digest,p_tenant,p_store);
  IF v_role NOT IN ('owner','manager','cashier') OR p_bill IS NULL THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM rcat.stores s
  WHERE s.tenant_id=p_tenant AND s.id=p_store FOR UPDATE;
  SELECT b.table_id INTO v_table FROM rcat.bills b
  WHERE b.id=p_bill AND b.tenant_id=p_tenant AND b.store_id=p_store;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM rcat.store_tables t
  WHERE t.tenant_id=p_tenant AND t.store_id=p_store
    AND t.id=v_table FOR UPDATE;
  SELECT b.visit_id,b.closed_at INTO v_visit,v_closed
  FROM rcat.bills b
  WHERE b.id=p_bill AND b.tenant_id=p_tenant AND b.store_id=p_store
  FOR UPDATE;
  IF v_closed IS NOT NULL THEN
    RETURN jsonb_build_object(
      'billId',p_bill,'status','closed','closedAt',v_closed,
      'replayed',true,'paymentVerified',false
    );
  END IF;
  v_now:=clock_timestamp();
  UPDATE rcat.bills
  SET closed_at=v_now,closed_by=v_actor,close_reason='merchant'
  WHERE id=p_bill AND tenant_id=p_tenant AND store_id=p_store;
  UPDATE rcat.table_ordering_visits
  SET revoked_at=v_now
  WHERE id=v_visit AND tenant_id=p_tenant AND store_id=p_store
    AND revoked_at IS NULL;
  UPDATE rcat.table_guest_grants
  SET revoked_at=v_now
  WHERE visit_id=v_visit AND revoked_at IS NULL;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata
  ) VALUES(
    p_tenant,v_actor,'bill.operational.closed',p_bill,
    jsonb_build_object('storeId',p_store,'visitId',v_visit,
      'source','merchant','paymentVerified',false)
  );
  RETURN jsonb_build_object(
    'billId',p_bill,'status','closed','closedAt',v_now,
    'replayed',false,'paymentVerified',false
  );
END $$;
REVOKE ALL ON FUNCTION rcat_private.close_operational_bill(
  bytea,uuid,uuid,uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.close_operational_bill(
  bytea,uuid,uuid,uuid
) TO rcat_auth;

-- Extend only the existing changed SQL functions; do not refactor Order
-- pricing, outbox, payment request or untouched Guest catalogs.

CREATE OR REPLACE FUNCTION rcat_private.create_operational_bill(
  p_session_digest bytea,p_tenant_id uuid,p_store_id uuid,p_visit_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;v_visit rcat.table_ordering_visits%ROWTYPE;
  v_bill uuid;v_created boolean:=false;v_other_visit uuid;
BEGIN
  SELECT actor_id,staff_role INTO v_actor,v_role
  FROM rcat_private._order_staff_actor(
    p_session_digest,p_tenant_id,p_store_id);
  IF v_role NOT IN ('owner','manager','cashier') THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;
  IF p_visit_id IS NULL THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;
  -- Same serializing lock as public Checkout and Bill close.
  PERFORM 1 FROM rcat.stores s
  WHERE s.tenant_id=p_tenant_id AND s.id=p_store_id FOR UPDATE;
  SELECT * INTO v_visit FROM rcat.table_ordering_visits
  WHERE id=p_visit_id AND tenant_id=p_tenant_id AND store_id=p_store_id
    AND revoked_at IS NULL AND expires_at>clock_timestamp()
  FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM rcat.orders o
    WHERE o.tenant_id=p_tenant_id AND o.store_id=p_store_id
      AND o.visit_id=p_visit_id
  ) THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;

  SELECT b.visit_id INTO v_other_visit FROM rcat.bills b
  WHERE b.tenant_id=p_tenant_id AND b.store_id=p_store_id
    AND b.table_id=v_visit.table_id AND b.closed_at IS NULL
    AND b.visit_id<>p_visit_id;
  IF FOUND THEN
    RAISE EXCEPTION 'Previous table Bill must be closed first'
      USING ERRCODE='P0043';
  END IF;
  IF EXISTS(
    SELECT 1 FROM rcat.bills b
    WHERE b.visit_id=p_visit_id AND b.closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Closed Bill cannot be reopened'
      USING ERRCODE='P0043';
  END IF;

  INSERT INTO rcat.bills(tenant_id,store_id,table_id,visit_id,created_by)
  VALUES (p_tenant_id,p_store_id,v_visit.table_id,p_visit_id,v_actor)
  ON CONFLICT(visit_id) DO NOTHING RETURNING id INTO v_bill;

  IF v_bill IS NULL THEN
    SELECT id INTO v_bill FROM rcat.bills
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id
      AND visit_id=p_visit_id;
  ELSE
    v_created:=true;
    INSERT INTO rcat.audit_events(
      tenant_id,actor_user_id,action,subject_id,metadata
    ) VALUES (
      p_tenant_id,v_actor,'bill.operational.created',v_bill,
      jsonb_build_object('storeId',p_store_id,'visitId',p_visit_id)
    );
  END IF;
  RETURN jsonb_build_object('billId',v_bill,'created',v_created);
END $$;

CREATE OR REPLACE FUNCTION rcat_private.operational_bill_snapshot(
  p_session_digest bytea,p_tenant_id uuid,p_store_id uuid,
  p_bill_id uuid,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_bill rcat.bills%ROWTYPE;v_order_count bigint;
  v_operational bigint;v_cancelled bigint;v_orders jsonb;
BEGIN
  PERFORM 1 FROM rcat_private._order_staff_actor(
    p_session_digest,p_tenant_id,p_store_id);
  IF p_bill_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid Bill request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_bill FROM rcat.bills
  WHERE id=p_bill_id AND tenant_id=p_tenant_id AND store_id=p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;

  SELECT count(*),
    coalesce(sum(CASE WHEN status<>'cancelled'
       THEN amount_satang ELSE 0 END),0),
    coalesce(sum(CASE WHEN status='cancelled'
       THEN amount_satang ELSE 0 END),0)
  INTO v_order_count,v_operational,v_cancelled
  FROM rcat.orders
  WHERE tenant_id=p_tenant_id AND store_id=p_store_id
    AND table_id=v_bill.table_id AND visit_id=v_bill.visit_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'orderId',o.id,'amountSatang',o.amount_satang,
      'currency',o.currency,'status',o.status,
      'paymentState',o.payment_state,'createdAt',o.created_at
    ) ORDER BY o.created_at,o.id),'[]'::jsonb)
  INTO v_orders
  FROM (
    SELECT * FROM rcat.orders
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id
      AND table_id=v_bill.table_id AND visit_id=v_bill.visit_id
    ORDER BY created_at,id LIMIT p_limit
  ) o;

  RETURN jsonb_build_object(
    'billId',v_bill.id,'tableId',v_bill.table_id,
    'visitId',v_bill.visit_id,'createdAt',v_bill.created_at,
    'status',CASE WHEN v_bill.closed_at IS NULL THEN 'open' ELSE 'closed' END,
    'closedAt',v_bill.closed_at,'closedBy',v_bill.closed_by,
    'closeReason',v_bill.close_reason,'creationSource',v_bill.creation_source,
    'orderCount',v_order_count,'hasMore',v_order_count>p_limit,
    'operationalTotalSatang',v_operational,
    'cancelledTotalSatang',v_cancelled,'currency','THB',
    'orders',v_orders
  );
END $$;

CREATE OR REPLACE FUNCTION rcat_private.place_guest_order_when_open(
 p_visit_digest bytea,p_idempotency_key text,p_cart jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_open boolean;v_visit uuid;v_existing rcat.orders%ROWTYPE;
  v_tenant uuid;v_store uuid;v_table uuid;v_bill uuid;v_result jsonb;
BEGIN
 -- Enforce required context even for direct SQL callers of this public gate.
 IF p_cart IS NULL
   OR jsonb_typeof(p_cart->'orderedBy') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_cart->'deliverTo') IS DISTINCT FROM 'string'
   OR length(btrim(p_cart->>'orderedBy')) NOT BETWEEN 1 AND 80
   OR length(btrim(p_cart->>'deliverTo')) NOT BETWEEN 1 AND 160
   OR (p_cart->>'orderedBy')~'[[:cntrl:]]'
   OR (p_cart->>'deliverTo')~'[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Required checkout context invalid'
     USING ERRCODE='22023';
 END IF;
 -- The pre-existing Order outbox trigger also takes a store FOR UPDATE lock
 -- to serialize sequence numbers. Acquire that same lock at the start:
 -- FOR SHARE here deadlocks on concurrent SHARE -> UPDATE conversions.
 SELECT s.ordering_enabled,v.id,v.tenant_id,v.store_id,v.table_id
 INTO v_open,v_visit,v_tenant,v_store,v_table
 FROM rcat.stores s
 JOIN rcat.table_ordering_visits v ON v.tenant_id=s.tenant_id AND v.store_id=s.id
 JOIN rcat.store_tables t ON t.id=v.table_id
   AND t.tenant_id=v.tenant_id AND t.store_id=v.store_id
 WHERE (v.token_digest=p_visit_digest OR EXISTS(
   SELECT 1 FROM rcat.table_guest_grants g
   WHERE g.visit_id=v.id AND g.token_digest=p_visit_digest
     AND g.expires_at>now()
 )) AND v.revoked_at IS NULL AND v.expires_at>now()
   AND t.active FOR UPDATE OF s;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501';
 END IF;
 -- A close/rotation may have been waiting on the same parent store lock.
 -- Revalidate the precise capability and active visit after acquiring it.
 PERFORM 1 FROM rcat.table_ordering_visits v
 JOIN rcat.store_tables t ON t.id=v.table_id
  AND t.tenant_id=v.tenant_id AND t.store_id=v.store_id
 WHERE v.id=v_visit AND v.revoked_at IS NULL
  AND v.expires_at>clock_timestamp() AND t.active
  AND (v.token_digest=p_visit_digest OR EXISTS(
    SELECT 1 FROM rcat.table_guest_grants g
    WHERE g.visit_id=v.id AND g.token_digest=p_visit_digest
      AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
  )) FOR SHARE OF v,t;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501';
 END IF;
 -- An already accepted idempotent retry is NOT a new Order. Return its
 -- authoritative receipt even if the merchant closed during network retry.
 SELECT * INTO v_existing FROM rcat.orders o
 WHERE o.visit_id=v_visit AND o.idempotency_key=p_idempotency_key;
 IF FOUND THEN
   IF v_existing.request_data IS DISTINCT FROM p_cart THEN
     RAISE EXCEPTION 'Idempotency key reused with changed cart'
       USING ERRCODE='23505';
   END IF;
   RETURN jsonb_build_object(
     'orderId',v_existing.id,'displayNumber',v_existing.display_number::text,'amountSatang',v_existing.amount_satang,
     'currency',v_existing.currency,'status',v_existing.status,
     'paymentState',v_existing.payment_state,'replayed',true);
 END IF;
 IF NOT v_open THEN
   RAISE EXCEPTION 'Ordering closed' USING ERRCODE='P0040';
 END IF;
 -- No new visit can append to a still-open Bill from an older cycle.
 PERFORM 1 FROM rcat.bills b WHERE b.tenant_id=v_tenant AND b.store_id=v_store
  AND b.table_id=v_table AND b.closed_at IS NULL AND b.visit_id<>v_visit;
 IF FOUND THEN
   RAISE EXCEPTION 'Previous table Bill must be closed first'
     USING ERRCODE='P0043';
 END IF;
 v_result:=rcat_private.place_guest_order(
   p_visit_digest,p_idempotency_key,p_cart);
 v_bill:=rcat_private._ensure_table_bill_for_visit(
   v_tenant,v_store,v_table,v_visit);
 RETURN v_result||jsonb_build_object('billId',v_bill);
END $$;
