-- Per-Order ownership of current public Table checkout; capability digests
-- remain private, never appear in the Merchant inbox or guest receipts.
CREATE TABLE rcat_private.table_order_guest_owners (
 order_id uuid PRIMARY KEY REFERENCES rcat.orders(id) ON DELETE CASCADE,
 token_digest bytea NOT NULL CHECK(octet_length(token_digest)=32)
);
REVOKE ALL ON rcat_private.table_order_guest_owners FROM PUBLIC,rcat_app,rcat_auth;

-- D: expose existing Bill by immutable Visit ID (including expired Visits).
-- Read only; do not use create_bill as a lookup or create a synthetic Bill.
CREATE FUNCTION rcat_private.operational_bill_by_visit(
 p_digest bytea,p_tenant uuid,p_store uuid,p_visit uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_bill uuid;
BEGIN
 PERFORM 1 FROM rcat_private._order_staff_actor(p_digest,p_tenant,p_store);
 SELECT id INTO v_bill FROM rcat.bills
 WHERE tenant_id=p_tenant AND store_id=p_store AND visit_id=p_visit;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
 END IF;
 RETURN rcat_private.operational_bill_snapshot(p_digest,p_tenant,p_store,v_bill,50);
END $$;
REVOKE ALL ON FUNCTION rcat_private.operational_bill_by_visit(bytea,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.operational_bill_by_visit(bytea,uuid,uuid,uuid) TO rcat_auth;

-- Enforce Quick-only mode at both the static Table entry and Table Checkout
-- boundaries. Hybrid/Table retain the existing Table API and Bill semantics.
CREATE OR REPLACE FUNCTION rcat_private.open_printed_ordering_table(
 p_tenant uuid,p_store uuid,p_table uuid,p_master_digest bytea,p_guest_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_open boolean;v_name text;v_label text;
 v_visit uuid;v_expires timestamptz;v_grants integer;
BEGIN
 IF p_tenant IS NULL OR p_store IS NULL OR p_table IS NULL
   OR p_master_digest IS NULL OR octet_length(p_master_digest)<>32
   OR p_guest_digest IS NULL OR octet_length(p_guest_digest)<>32
   OR p_master_digest=p_guest_digest THEN
   RAISE EXCEPTION 'Table unavailable' USING ERRCODE='42501';
 END IF;
 SELECT s.ordering_enabled,s.display_name INTO v_open,v_name
 FROM rcat.stores s WHERE s.tenant_id=p_tenant AND s.id=p_store
 FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Table unavailable' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM rcat_private.store_service_modes
   WHERE tenant_id=p_tenant AND store_id=p_store AND service_mode='quick') THEN
   RAISE EXCEPTION 'Table service unavailable' USING ERRCODE='42501';
 END IF;
 SELECT t.label INTO v_label FROM rcat.store_tables t
 WHERE t.tenant_id=p_tenant AND t.store_id=p_store
   AND t.id=p_table AND t.active FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Table unavailable' USING ERRCODE='42501';
 END IF;
 IF NOT v_open THEN
   RETURN jsonb_build_object(
     'open',false,'storeName',v_name,'tableLabel',v_label);
 END IF;

 SELECT v.id,v.expires_at INTO v_visit,v_expires
 FROM rcat.table_ordering_visits v
 WHERE v.tenant_id=p_tenant AND v.store_id=p_store
   AND v.table_id=p_table AND v.revoked_at IS NULL
   AND v.expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN
   UPDATE rcat.table_ordering_visits SET revoked_at=clock_timestamp()
   WHERE tenant_id=p_tenant AND store_id=p_store AND table_id=p_table
     AND revoked_at IS NULL;
   INSERT INTO rcat.table_ordering_visits(
     tenant_id,store_id,table_id,token_digest,expires_at
   ) VALUES(
     p_tenant,p_store,p_table,p_master_digest,clock_timestamp()+interval '6 hours'
   ) RETURNING id,expires_at INTO v_visit,v_expires;
 END IF;

 SELECT count(*) INTO v_grants FROM rcat.table_guest_grants
 WHERE visit_id=v_visit;
 IF v_grants>=200 THEN
   RAISE EXCEPTION 'Table guest grant limit' USING ERRCODE='P0041';
 END IF;
 INSERT INTO rcat.table_guest_grants(visit_id,token_digest,expires_at)
 VALUES(v_visit,p_guest_digest,v_expires);
 RETURN jsonb_build_object(
   'open',true,'storeName',v_name,'tableLabel',v_label,
   'expiresAt',v_expires);
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
 IF EXISTS(SELECT 1 FROM rcat_private.store_service_modes
   WHERE tenant_id=v_tenant AND store_id=v_store AND service_mode='quick') THEN
   RAISE EXCEPTION 'Table service unavailable' USING ERRCODE='42501';
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
   -- An idempotency key is not an ownership credential. New public Orders
   -- are bound to the precise submitting grant; legacy Orders have only the
   -- master-visit binding and cannot be claimed by a different grant.
   IF NOT EXISTS (
     SELECT 1 FROM rcat_private.table_order_guest_owners g
     WHERE g.order_id=v_existing.id AND g.token_digest=p_visit_digest
   ) AND (
     EXISTS(SELECT 1 FROM rcat_private.table_order_guest_owners g WHERE g.order_id=v_existing.id)
     OR NOT EXISTS(SELECT 1 FROM rcat.table_ordering_visits v
       WHERE v.id=v_visit AND v.token_digest=p_visit_digest)
   ) THEN
     RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
   END IF;
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
 INSERT INTO rcat_private.table_order_guest_owners(order_id,token_digest)
 VALUES((v_result->>'orderId')::uuid,p_visit_digest);
 v_bill:=rcat_private._ensure_table_bill_for_visit(
   v_tenant,v_store,v_table,v_visit);
 RETURN v_result||jsonb_build_object('billId',v_bill);
END $$;


-- Tracking binding runs inside the same DB transaction as checkout. Preserve
-- existing Order-only status tokens; never accept a sibling Guest grant.
CREATE OR REPLACE FUNCTION rcat_private.bind_guest_order_tracking(
  p_order_id uuid, p_visit_digest bytea, p_idempotency_key text,
  p_tracking_digest bytea
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_existing bytea;
BEGIN
  IF p_order_id IS NULL
    OR p_visit_digest IS NULL OR octet_length(p_visit_digest)<>32
    OR p_tracking_digest IS NULL OR octet_length(p_tracking_digest)<>32
    OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 16 AND 96
  THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;

  SELECT o.tracking_token_digest INTO v_existing
  FROM rcat.orders o
  JOIN rcat.table_ordering_visits v
    ON v.id=o.visit_id AND v.tenant_id=o.tenant_id
       AND v.store_id=o.store_id
  WHERE o.id=p_order_id AND o.idempotency_key=p_idempotency_key
    AND (
      EXISTS (
        SELECT 1 FROM rcat_private.table_order_guest_owners g
        WHERE g.order_id=o.id AND g.token_digest=p_visit_digest
      )
      OR (
        v.token_digest=p_visit_digest
        AND NOT EXISTS (
          SELECT 1 FROM rcat_private.table_order_guest_owners g
          WHERE g.order_id=o.id
        )
      )
    )
    AND v.revoked_at IS NULL AND v.expires_at>clock_timestamp()
    AND (
      v.token_digest=p_visit_digest OR EXISTS (
        SELECT 1 FROM rcat.table_guest_grants g
        WHERE g.visit_id=v.id AND g.token_digest=p_visit_digest
          AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
      )
    )
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;

  IF v_existing IS NULL THEN
    UPDATE rcat.orders
      SET tracking_token_digest=p_tracking_digest
      WHERE id=p_order_id;
  ELSIF v_existing<>p_tracking_digest THEN
    RAISE EXCEPTION 'Tracking capability mismatch' USING ERRCODE='23505';
  END IF;
END $$;
