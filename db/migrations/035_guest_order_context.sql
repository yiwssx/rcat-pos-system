-- G2/G3: Canonical identity, delivery and item notes are server snapshots.
-- Old Orders retain NULL identity/delivery; trusted legacy SQL fixture remains compatible.
-- No Payment, stock reservation or Production behavior is introduced.
ALTER TABLE rcat.orders
  ADD COLUMN ordered_by text,
  ADD COLUMN deliver_to text,
  ADD CONSTRAINT orders_ordered_by_valid CHECK (
    ordered_by IS NULL OR
    (length(ordered_by) BETWEEN 1 AND 80 AND ordered_by !~ '[[:cntrl:]]')
  ),
  ADD CONSTRAINT orders_deliver_to_valid CHECK (
    deliver_to IS NULL OR
    (length(deliver_to) BETWEEN 1 AND 160 AND deliver_to !~ '[[:cntrl:]]')
  );

ALTER TABLE rcat.order_items
  ADD COLUMN special_instructions text NOT NULL DEFAULT ''
  CHECK (length(special_instructions)<=240 AND
         special_instructions !~ '[[:cntrl:]]');

CREATE OR REPLACE FUNCTION rcat_private.place_guest_order(
 p_visit_digest bytea,p_idempotency_key text,p_cart jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
 v_visit rcat.table_ordering_visits%ROWTYPE;
 v_existing rcat.orders%ROWTYPE;
 v_order_id uuid;
 v_amount bigint:=0;
 v_total_qty integer:=0;
 v_item jsonb;
 v_selected jsonb;
 v_pid uuid;
 v_qty integer;
 v_product rcat.menu_products%ROWTYPE;
 v_group rcat.menu_modifier_groups%ROWTYPE;
 v_option rcat.menu_modifier_options%ROWTYPE;
 v_unit bigint;
 v_line_total bigint;
 v_snapshots jsonb;
 v_option_str text;
 v_opt_id uuid;
 v_count integer;
 v_seen_ids uuid[];
 v_ordered_by text;
 v_deliver_to text;
 v_note text;
BEGIN
 IF p_visit_digest IS NULL OR octet_length(p_visit_digest)<>32
   OR p_idempotency_key IS NULL
   OR length(p_idempotency_key) NOT BETWEEN 16 AND 96
   OR p_idempotency_key !~ '^[A-Za-z0-9_-]+$'
 THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;
 IF p_cart IS NULL OR jsonb_typeof(p_cart)<>'object'
   OR jsonb_typeof(p_cart->'items')<>'array'
   OR jsonb_array_length(p_cart->'items') NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION 'Invalid cart' USING ERRCODE='22023'; END IF;

 -- Trusted historical SQL fixtures may omit context; the public gate below requires it.
 IF (p_cart ? 'orderedBy') OR (p_cart ? 'deliverTo') THEN
   IF jsonb_typeof(p_cart->'orderedBy')<>'string'
     OR jsonb_typeof(p_cart->'deliverTo')<>'string' THEN
     RAISE EXCEPTION 'Order context invalid' USING ERRCODE='22023';
   END IF;
   v_ordered_by:=btrim(p_cart->>'orderedBy');
   v_deliver_to:=btrim(p_cart->>'deliverTo');
   IF length(v_ordered_by) NOT BETWEEN 1 AND 80
     OR length(v_deliver_to) NOT BETWEEN 1 AND 160
     OR v_ordered_by~'[[:cntrl:]]'
     OR v_deliver_to~'[[:cntrl:]]' THEN
     RAISE EXCEPTION 'Order context invalid' USING ERRCODE='22023';
   END IF;
 END IF;

 SELECT visit.* INTO v_visit FROM rcat.table_ordering_visits visit
 JOIN rcat.store_tables t ON t.id=visit.table_id
   AND t.tenant_id=visit.tenant_id AND t.store_id=visit.store_id
 WHERE visit.token_digest=p_visit_digest AND visit.revoked_at IS NULL
   AND visit.expires_at>now() AND t.active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM rcat.store_tables t
  WHERE t.id=v_visit.table_id AND t.tenant_id=v_visit.tenant_id
   AND t.store_id=v_visit.store_id AND t.active FOR SHARE;
 -- Revalidate after waiting for a concurrent rotation.
 PERFORM 1 FROM rcat.table_ordering_visits v
  WHERE v.id=v_visit.id AND v.revoked_at IS NULL AND v.expires_at>now()
  FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501'; END IF;

 -- Unique index serializes even simultaneous requests from different app pods.
 INSERT INTO rcat.orders(
   tenant_id,store_id,table_id,visit_id,idempotency_key,request_data,
   ordered_by,deliver_to
 ) VALUES(
   v_visit.tenant_id,v_visit.store_id,v_visit.table_id,v_visit.id,
   p_idempotency_key,p_cart,v_ordered_by,v_deliver_to
 ) ON CONFLICT(visit_id,idempotency_key) DO NOTHING
 RETURNING id INTO v_order_id;
 IF v_order_id IS NULL THEN
   SELECT * INTO v_existing FROM rcat.orders
   WHERE visit_id=v_visit.id AND idempotency_key=p_idempotency_key;
   IF NOT FOUND OR v_existing.request_data<>p_cart THEN
     RAISE EXCEPTION 'Idempotency key reused with changed cart' USING ERRCODE='23505';
   END IF;
   RETURN jsonb_build_object(
     'orderId',v_existing.id,'amountSatang',v_existing.amount_satang,
     'currency',v_existing.currency,'status',v_existing.status,
     'paymentState',v_existing.payment_state,'replayed',true
   );
 END IF;

 FOR v_item IN SELECT value FROM jsonb_array_elements(p_cart->'items')
 LOOP
   IF jsonb_typeof(v_item)<>'object'
     OR jsonb_typeof(v_item->'productId')<>'string'
     OR jsonb_typeof(v_item->'quantity')<>'number'
     OR (v_item->>'quantity') !~ '^[0-9]{1,2}$'
     OR jsonb_typeof(v_item->'optionIds')<>'array'
     OR jsonb_array_length(v_item->'optionIds')>32
   THEN RAISE EXCEPTION 'Invalid cart item' USING ERRCODE='22023'; END IF;
   BEGIN
     v_pid:=(v_item->>'productId')::uuid;
     v_qty:=(v_item->>'quantity')::integer;
   EXCEPTION WHEN invalid_text_representation THEN
     RAISE EXCEPTION 'Invalid product reference' USING ERRCODE='22023';
   END;
   IF v_qty NOT BETWEEN 1 AND 20 THEN
     RAISE EXCEPTION 'Invalid quantity' USING ERRCODE='22023'; END IF;
   v_note:='';
   IF v_item ? 'note' THEN
     IF jsonb_typeof(v_item->'note')<>'string' THEN
       RAISE EXCEPTION 'Invalid item note' USING ERRCODE='22023';
     END IF;
     v_note:=btrim(v_item->>'note');
     IF length(v_note)>240 OR v_note~'[[:cntrl:]]' THEN
       RAISE EXCEPTION 'Invalid item note' USING ERRCODE='22023';
     END IF;
   END IF;
   v_total_qty:=v_total_qty+v_qty;
   IF v_total_qty>100 THEN
     RAISE EXCEPTION 'Too many items' USING ERRCODE='22023'; END IF;

   SELECT * INTO v_product FROM rcat.menu_products
    WHERE tenant_id=v_visit.tenant_id AND store_id=v_visit.store_id
      AND id=v_pid AND available FOR SHARE;
   IF NOT FOUND THEN
     RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;

   v_unit:=v_product.price_satang;
   v_snapshots:='[]'::jsonb;
   v_seen_ids:=ARRAY[]::uuid[];
   v_selected:=v_item->'optionIds';
   FOR v_option_str IN SELECT value FROM jsonb_array_elements_text(v_selected)
   LOOP
     BEGIN
       v_opt_id:=v_option_str::uuid;
     EXCEPTION WHEN invalid_text_representation THEN
       RAISE EXCEPTION 'Invalid option reference' USING ERRCODE='22023';
     END;
     IF v_opt_id=ANY(v_seen_ids) THEN
       RAISE EXCEPTION 'Duplicate modifier' USING ERRCODE='22023'; END IF;
     v_seen_ids:=array_append(v_seen_ids,v_opt_id);
     SELECT * INTO v_option FROM rcat.menu_modifier_options
      WHERE id=v_opt_id AND tenant_id=v_visit.tenant_id
        AND store_id=v_visit.store_id AND product_id=v_pid AND available
      FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Modifier unavailable' USING ERRCODE='42501'; END IF;
     v_unit:=v_unit+v_option.price_delta_satang;
     v_snapshots:=v_snapshots||jsonb_build_array(jsonb_build_object(
       'optionId',v_option.id,'groupId',v_option.group_id,
       'name',v_option.name,'priceDeltaSatang',v_option.price_delta_satang
     ));
   END LOOP;

   -- Locks group rows against concurrent group/option structure updates.
   FOR v_group IN SELECT * FROM rcat.menu_modifier_groups g
      WHERE g.tenant_id=v_visit.tenant_id AND g.store_id=v_visit.store_id
       AND g.product_id=v_pid FOR SHARE
   LOOP
     SELECT count(*) INTO v_count FROM rcat.menu_modifier_options o
       WHERE o.id=ANY(v_seen_ids) AND o.group_id=v_group.id
         AND o.tenant_id=v_visit.tenant_id
         AND o.store_id=v_visit.store_id AND o.product_id=v_pid;
     IF v_count<v_group.min_select OR v_count>v_group.max_select THEN
       RAISE EXCEPTION 'Required modifier selection invalid'
         USING ERRCODE='22023';
     END IF;
   END LOOP;
   IF v_unit NOT BETWEEN 1 AND 100000000 THEN
     RAISE EXCEPTION 'Unit price outside allowed range' USING ERRCODE='22023';
   END IF;
   v_line_total:=v_unit*v_qty;
   v_amount:=v_amount+v_line_total;
   IF v_amount>100000000 THEN
     RAISE EXCEPTION 'Order amount exceeds limit' USING ERRCODE='22023';
   END IF;
   INSERT INTO rcat.order_items(
     tenant_id,store_id,order_id,product_id,product_name,
     quantity,base_price_satang,unit_price_satang,line_total_satang,
     option_snapshots,special_instructions
   ) VALUES(
     v_visit.tenant_id,v_visit.store_id,v_order_id,v_pid,v_product.name,
     v_qty,v_product.price_satang,v_unit,v_line_total,v_snapshots,v_note
   );
 END LOOP;
 UPDATE rcat.orders SET amount_satang=v_amount WHERE id=v_order_id;
 RETURN jsonb_build_object(
   'orderId',v_order_id,'amountSatang',v_amount,'currency','THB',
   'status','submitted','paymentState','not_requested','replayed',false
 );
END $$;

CREATE OR REPLACE FUNCTION rcat_private.place_guest_order_when_open(
 p_visit_digest bytea,p_idempotency_key text,p_cart jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_open boolean;v_visit uuid;v_existing rcat.orders%ROWTYPE;
BEGIN
 -- Enforce required context even for direct SQL callers of this public gate.
 IF p_cart IS NULL
   OR jsonb_typeof(p_cart->'orderedBy')<>'string'
   OR jsonb_typeof(p_cart->'deliverTo')<>'string'
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
 SELECT s.ordering_enabled,v.id INTO v_open,v_visit
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
     'orderId',v_existing.id,'amountSatang',v_existing.amount_satang,
     'currency',v_existing.currency,'status',v_existing.status,
     'paymentState',v_existing.payment_state,'replayed',true);
 END IF;
 IF NOT v_open THEN
   RAISE EXCEPTION 'Ordering closed' USING ERRCODE='P0040';
 END IF;
 RETURN rcat_private.place_guest_order(p_visit_digest,p_idempotency_key,p_cart);
END $$;

CREATE OR REPLACE FUNCTION rcat_private.merchant_order_inbox_page(
  p_digest bytea,p_tenant_id uuid,p_store_id uuid,
  p_status text DEFAULT NULL,p_limit integer DEFAULT 50,
  p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_orders jsonb;v_has_more boolean;v_next text;
BEGIN
  PERFORM 1 FROM rcat_private._order_staff_actor(
    p_digest,p_tenant_id,p_store_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR (p_status IS NOT NULL AND p_status NOT IN
      ('submitted','accepted','preparing','served','cancelled'))
    OR (p_before_at IS NULL)<>(p_before_id IS NULL)
  THEN
    RAISE EXCEPTION 'Invalid Order page filter' USING ERRCODE='22023';
  END IF;

  WITH candidate AS MATERIALIZED (
    SELECT * FROM rcat.orders
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id
      AND (p_status IS NULL OR status=p_status)
      AND (p_before_at IS NULL
        OR (created_at,id)<(p_before_at,p_before_id))
    ORDER BY created_at DESC,id DESC
    LIMIT p_limit+1
  ), visible AS MATERIALIZED (
    SELECT * FROM candidate ORDER BY created_at DESC,id DESC LIMIT p_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'orderId',o.id,'visitId',o.visit_id,'tableId',o.table_id,
    'amountSatang',o.amount_satang,'currency',o.currency,
    'orderedBy',o.ordered_by,'deliverTo',o.deliver_to,
    'status',o.status,'paymentState',o.payment_state,
    'createdAt',o.created_at,'updatedAt',o.updated_at,
    'items',(SELECT coalesce(jsonb_agg(jsonb_build_object(
       'productName',i.product_name,'quantity',i.quantity,
       'basePriceSatang',i.base_price_satang,
       'unitPriceSatang',i.unit_price_satang,
       'lineTotalSatang',i.line_total_satang,
       'options',i.option_snapshots,
       'note',i.special_instructions
     ) ORDER BY i.created_at,i.id),'[]'::jsonb)
     FROM rcat.order_items i
     WHERE i.tenant_id=o.tenant_id AND i.store_id=o.store_id
       AND i.order_id=o.id)
  ) ORDER BY o.created_at DESC,o.id DESC),'[]'::jsonb),
    (SELECT count(*)>p_limit FROM candidate),
    (SELECT to_char(v.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'_'||v.id::text
     FROM visible v
     ORDER BY v.created_at ASC,v.id ASC LIMIT 1)
  INTO v_orders,v_has_more,v_next
  FROM visible o;

  RETURN jsonb_build_object(
    'orders',v_orders,'hasMore',v_has_more,
    'nextCursor',CASE WHEN v_has_more THEN v_next ELSE NULL END
  );
END $$;

CREATE OR REPLACE FUNCTION rcat_private.merchant_order_lookup_ids(
  p_digest bytea,p_tenant_id uuid,p_store_id uuid,p_order_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_orders jsonb;
BEGIN
  PERFORM 1 FROM rcat_private._order_staff_actor(
    p_digest,p_tenant_id,p_store_id);

  IF p_order_ids IS NULL OR cardinality(p_order_ids) NOT BETWEEN 1 AND 50
    OR (SELECT count(DISTINCT x) FROM unnest(p_order_ids) x)<>cardinality(p_order_ids)
  THEN RAISE EXCEPTION 'Invalid Order lookup ids' USING ERRCODE='22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'orderId',o.id,'visitId',o.visit_id,'tableId',o.table_id,
    'amountSatang',o.amount_satang,'currency',o.currency,
    'orderedBy',o.ordered_by,'deliverTo',o.deliver_to,
    'status',o.status,'paymentState',o.payment_state,
    'createdAt',o.created_at,'updatedAt',o.updated_at,
    'items',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'productName',i.product_name,'quantity',i.quantity,
      'basePriceSatang',i.base_price_satang,
      'unitPriceSatang',i.unit_price_satang,
      'lineTotalSatang',i.line_total_satang,
      'options',i.option_snapshots,
       'note',i.special_instructions
    ) ORDER BY i.created_at,i.id),'[]'::jsonb)
    FROM rcat.order_items i
    WHERE i.tenant_id=o.tenant_id AND i.store_id=o.store_id
      AND i.order_id=o.id)
  ) ORDER BY o.created_at DESC,o.id DESC),'[]'::jsonb)
  INTO v_orders
  FROM rcat.orders o
  WHERE o.tenant_id=p_tenant_id AND o.store_id=p_store_id
    AND o.id=ANY(p_order_ids);

  -- Unknown, foreign-store or deleted Order references are omitted rather
  -- than returning a 404 that could reveal whether an ID exists elsewhere.
  -- The Merchant client MUST check complete coverage before Outbox ack.
  RETURN jsonb_build_object('orders',v_orders);
END $$;
