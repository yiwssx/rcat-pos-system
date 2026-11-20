-- G2/G3 #102 / C — counter-only Order identity, append and Preparing cutoff.
-- This deliberately never reuses Table Visit or a public Store QR identifier
-- as a customer ownership grant. No G5 Payment activation or Production action.

ALTER TABLE rcat.orders
  ALTER COLUMN table_id DROP NOT NULL,
  ALTER COLUMN visit_id DROP NOT NULL,
  ADD COLUMN quick_session_id uuid REFERENCES rcat_private.store_guest_sessions(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT orders_quick_or_table_identity CHECK(
    (table_id IS NOT NULL AND visit_id IS NOT NULL AND quick_session_id IS NULL)
    OR (table_id IS NULL AND visit_id IS NULL AND quick_session_id IS NOT NULL)
  );
CREATE UNIQUE INDEX quick_orders_session_key_idx
 ON rcat.orders(quick_session_id,idempotency_key)
 WHERE quick_session_id IS NOT NULL;
CREATE INDEX quick_orders_session_created_idx
 ON rcat.orders(quick_session_id,created_at DESC,id DESC)
 WHERE quick_session_id IS NOT NULL;

-- The existing Merchant SSE/Outbox must also support no physical Table and
-- a refreshed amount on append, without pretending that status transitioned.
ALTER TABLE rcat.order_outbox_events ALTER COLUMN table_id DROP NOT NULL;
ALTER TABLE rcat.order_outbox_events
 DROP CONSTRAINT order_outbox_events_event_type_check;
ALTER TABLE rcat.order_outbox_events
 ADD CONSTRAINT order_outbox_events_event_type_check CHECK(
   event_type IN ('order.submitted','order.status.changed','order.items.added')
 );
ALTER TABLE rcat.order_outbox_events
 DROP CONSTRAINT order_outbox_events_check;
ALTER TABLE rcat.order_outbox_events
 ADD CONSTRAINT order_outbox_events_check CHECK(
   (event_type='order.submitted' AND status='submitted'
      AND previous_status IS NULL)
   OR (event_type='order.status.changed' AND previous_status IS NOT NULL
      AND previous_status<>status)
   OR (event_type='order.items.added' AND status IN ('submitted','accepted')
      AND previous_status IS NULL)
 );

CREATE FUNCTION rcat_private._quick_order_amount_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  -- First Order's 0 -> amount update is covered by order.submitted insert.
  IF NEW.quick_session_id IS NOT NULL AND OLD.amount_satang>0
    AND NEW.amount_satang>OLD.amount_satang THEN
    INSERT INTO rcat.order_outbox_events(
      tenant_id,store_id,order_id,table_id,event_type,status,previous_status
    ) VALUES(
      NEW.tenant_id,NEW.store_id,NEW.id,NULL,'order.items.added',NEW.status,NULL
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quick_order_amount_outbox
AFTER UPDATE OF amount_satang ON rcat.orders
FOR EACH ROW WHEN (
  NEW.quick_session_id IS NOT NULL AND
  OLD.amount_satang>0 AND NEW.amount_satang>OLD.amount_satang
) EXECUTE FUNCTION rcat_private._quick_order_amount_outbox();
REVOKE ALL ON FUNCTION rcat_private._quick_order_amount_outbox() FROM PUBLIC;

-- One request key is scoped strictly to its unique Guest possession session.
-- Durable immutable action payload makes retries safe on any API replica.
CREATE TABLE rcat_private.quick_order_actions(
  session_id uuid NOT NULL REFERENCES rcat_private.store_guest_sessions(id)
    ON DELETE RESTRICT,
  idempotency_key text NOT NULL
    CHECK(length(idempotency_key) BETWEEN 16 AND 96),
  requested_order_id uuid,
  request_data jsonb NOT NULL CHECK(jsonb_typeof(request_data)='object'),
  result_order_id uuid NOT NULL REFERENCES rcat.orders(id) ON DELETE RESTRICT,
  action text NOT NULL
    CHECK(action IN ('created','appended','new_after_cutoff')),
  added_satang bigint NOT NULL CHECK(added_satang BETWEEN 1 AND 100000000),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(session_id,idempotency_key)
);
REVOKE ALL ON rcat_private.quick_order_actions FROM PUBLIC,rcat_auth,rcat_app;

-- Price-authoritative line insert adapted from *exact* latest Table checkout
-- pricing/modifier validation (041), without a fake Table Visit.
CREATE FUNCTION rcat_private._quick_insert_lines(
  p_tenant uuid,p_store uuid,p_order uuid,p_cart jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
 v_amount bigint:=0;v_total_qty integer:=0;
 v_item jsonb;v_selected jsonb;v_pid uuid;v_qty integer;
 v_product rcat.menu_products%ROWTYPE;
 v_group rcat.menu_modifier_groups%ROWTYPE;
 v_option rcat.menu_modifier_options%ROWTYPE;
 v_unit bigint;v_line_total bigint;v_snapshots jsonb;
 v_option_str text;v_opt_id uuid;v_count integer;v_seen_ids uuid[];
 v_note text;v_item_id uuid;v_item_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
 IF p_cart IS NULL OR jsonb_typeof(p_cart)<>'object'
   OR jsonb_typeof(p_cart->'items')<>'array'
   OR jsonb_array_length(p_cart->'items') NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION 'Invalid cart' USING ERRCODE='22023'; END IF;
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
    WHERE tenant_id=p_tenant AND store_id=p_store
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
      WHERE id=v_opt_id AND tenant_id=p_tenant
        AND store_id=p_store AND product_id=v_pid AND available
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
      WHERE g.tenant_id=p_tenant AND g.store_id=p_store
       AND g.product_id=v_pid FOR SHARE
   LOOP
     SELECT count(*) INTO v_count FROM rcat.menu_modifier_options o
       WHERE o.id=ANY(v_seen_ids) AND o.group_id=v_group.id
         AND o.tenant_id=p_tenant
         AND o.store_id=p_store AND o.product_id=v_pid;
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
     p_tenant,p_store,p_order,v_pid,v_product.name,
     v_qty,v_product.price_satang,v_unit,v_line_total,v_snapshots,v_note
   ) RETURNING id INTO v_item_id;
   v_item_ids:=array_append(v_item_ids,v_item_id);
 END LOOP;
 RETURN jsonb_build_object('addedSatang',v_amount,'itemIds',v_item_ids);
END $$;
REVOKE ALL ON FUNCTION rcat_private._quick_insert_lines(
  uuid,uuid,uuid,jsonb
) FROM PUBLIC;

-- Accepted != Preparing: reserve incremental inventory for ONLY newly
-- appended lines, retaining the original acceptance allocation unchanged.
-- Inventory movement actor is the staff member who ACCEPTED the Order;
-- reason/audit explicitly attributes the new demand to a Guest add-on.
CREATE FUNCTION rcat_private._quick_allocate_accepted_addon(
  p_tenant uuid,p_store uuid,p_order uuid,p_item_ids uuid[]
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_product record;v_need record;v_actor uuid;
  v_count integer:=0;v_qty numeric;
BEGIN
  IF p_item_ids IS NULL OR cardinality(p_item_ids)<1 THEN
    RAISE EXCEPTION 'No Quick add-on lines' USING ERRCODE='22023';
  END IF;
  SELECT a.actor_user_id INTO v_actor FROM rcat.audit_events a
  WHERE a.tenant_id=p_tenant AND a.subject_id=p_order
    AND a.action='order.status.changed'
    AND a.metadata->>'to'='accepted'
  ORDER BY a.id DESC LIMIT 1;
  IF NOT FOUND OR v_actor IS NULL THEN
    RAISE EXCEPTION 'Accepted Order has no responsible staff actor'
      USING ERRCODE='P0004';
  END IF;
  FOR v_product IN
    SELECT p.id FROM rcat.menu_products p
    WHERE p.tenant_id=p_tenant AND p.store_id=p_store
      AND p.id IN (
        SELECT DISTINCT i.product_id FROM rcat.order_items i
        JOIN rcat.inventory_tracked_products t
          ON t.tenant_id=i.tenant_id AND t.store_id=i.store_id
          AND t.product_id=i.product_id
        WHERE i.tenant_id=p_tenant AND i.store_id=p_store
          AND i.order_id=p_order AND i.id=ANY(p_item_ids)
      )
    ORDER BY p.id FOR SHARE
  LOOP
    IF NOT EXISTS(
      SELECT 1 FROM rcat.inventory_recipe_components
      WHERE tenant_id=p_tenant AND store_id=p_store
        AND product_id=v_product.id
    ) THEN
      RAISE EXCEPTION 'Tracked add-on lacks ingredient recipe'
        USING ERRCODE='P0005';
    END IF;
  END LOOP;

  FOR v_need IN
    SELECT stock.id AS item_id,stock.on_hand,requirements.needed
    FROM (
      SELECT parts.item_id,sum(parts.qty)::numeric AS needed FROM (
        SELECT recipe.item_id,recipe.quantity_per_product*line.quantity AS qty
        FROM rcat.order_items line
        JOIN rcat.inventory_tracked_products t
          ON t.tenant_id=line.tenant_id AND t.store_id=line.store_id
          AND t.product_id=line.product_id
        JOIN rcat.inventory_recipe_components recipe
          ON recipe.tenant_id=line.tenant_id AND recipe.store_id=line.store_id
          AND recipe.product_id=line.product_id
        WHERE line.tenant_id=p_tenant AND line.store_id=p_store
          AND line.order_id=p_order AND line.id=ANY(p_item_ids)
        UNION ALL
        SELECT recipe.item_id,recipe.quantity_per_product*line.quantity AS qty
        FROM rcat.order_items line
        JOIN rcat.inventory_tracked_products t
          ON t.tenant_id=line.tenant_id AND t.store_id=line.store_id
          AND t.product_id=line.product_id
        CROSS JOIN LATERAL jsonb_array_elements(line.option_snapshots) opt
        JOIN rcat.inventory_modifier_recipe_components recipe
          ON recipe.tenant_id=line.tenant_id AND recipe.store_id=line.store_id
          AND recipe.product_id=line.product_id
          AND recipe.option_id::text=opt->>'optionId'
        WHERE line.tenant_id=p_tenant AND line.store_id=p_store
          AND line.order_id=p_order AND line.id=ANY(p_item_ids)
      ) parts GROUP BY parts.item_id
    ) requirements
    JOIN rcat.inventory_items stock
      ON stock.tenant_id=p_tenant AND stock.store_id=p_store
      AND stock.id=requirements.item_id
    ORDER BY stock.id FOR UPDATE OF stock
  LOOP
    v_qty:=v_need.needed;
    IF v_qty<=0 OR v_qty>1000000000 OR scale(v_qty)>3
      OR v_need.on_hand<v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for Quick add-on'
        USING ERRCODE='P0004';
    END IF;
    INSERT INTO rcat.inventory_order_allocations(
      tenant_id,store_id,order_id,item_id,quantity
    ) VALUES(p_tenant,p_store,p_order,v_need.item_id,v_qty)
    ON CONFLICT(tenant_id,store_id,order_id,item_id)
    DO UPDATE SET quantity=rcat.inventory_order_allocations.quantity
      +EXCLUDED.quantity
    WHERE rcat.inventory_order_allocations.returned_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Returned Order allocation cannot be extended'
        USING ERRCODE='P0004';
    END IF;
    UPDATE rcat.inventory_items SET
      on_hand=on_hand-v_qty,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND store_id=p_store AND id=v_need.item_id;
    INSERT INTO rcat.inventory_movements(
      tenant_id,store_id,item_id,idempotency_key,kind,delta,
      quantity_before,quantity_after,reason,actor_user_id,order_id
    ) VALUES(p_tenant,p_store,v_need.item_id,gen_random_uuid(),
      'order_consumption',-v_qty,v_need.on_hand,v_need.on_hand-v_qty,
      'Guest Quick add-on: '||p_order::text,v_actor,p_order);
    v_count:=v_count+1;
  END LOOP;
  IF v_count>0 THEN
    INSERT INTO rcat.audit_events(
      tenant_id,actor_user_id,action,subject_id,metadata
    ) VALUES(p_tenant,v_actor,'inventory.quick_addon.allocated',p_order,
      jsonb_build_object('storeId',p_store,'ingredients',v_count,
        'triggeredBy','guest_addon'));
  END IF;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION rcat_private._quick_allocate_accepted_addon(
  uuid,uuid,uuid,uuid[]
) FROM PUBLIC;

-- All Quick submissions and Merchant Preparing transitions serialize in
-- store -> order row lock order. This also matches the existing outbox
-- trigger, avoiding reverse-lock deadlocks across server replicas.
CREATE OR REPLACE FUNCTION rcat_private.transition_merchant_order(
  p_digest bytea, p_tenant_id uuid, p_store_id uuid, p_order_id uuid,
  p_expected text, p_next text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;v_order rcat.orders%ROWTYPE;
  v_stock_count integer:=0;
BEGIN
  SELECT actor_id,staff_role INTO v_actor,v_role
  FROM rcat_private._order_staff_actor(p_digest,p_tenant_id,p_store_id);
  IF p_order_id IS NULL OR p_expected IS NULL OR p_next IS NULL THEN
    RAISE EXCEPTION 'Invalid Order transition' USING ERRCODE='22023';
  END IF;
  -- Guest add-ons take the store lock before the Order row. Match that
  -- hierarchy for Merchant transitions to avoid deadlocks across replicas.
  PERFORM 1 FROM rcat.stores s
  WHERE s.tenant_id=p_tenant_id AND s.id=p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_order FROM rcat.orders
  WHERE id=p_order_id AND tenant_id=p_tenant_id AND store_id=p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;
  IF v_order.status<>p_expected THEN
    RAISE EXCEPTION 'Order status changed' USING ERRCODE='P0001';
  END IF;
  IF NOT (
    (p_expected='submitted' AND p_next IN ('accepted','cancelled')
      AND v_role IN ('owner','manager','cashier'))
    OR (p_expected='accepted' AND p_next='preparing'
      AND v_role IN ('owner','manager','kitchen'))
    OR (p_expected='accepted' AND p_next='cancelled'
      AND v_role IN ('owner','manager','cashier'))
    OR (p_expected='preparing' AND p_next='served'
      AND v_role IN ('owner','manager','kitchen'))
  ) THEN RAISE EXCEPTION 'Order transition not permitted' USING ERRCODE='42501'; END IF;

  IF p_expected='submitted' AND p_next='accepted' THEN
    v_stock_count:=rcat_private._allocate_order_stock(
      p_tenant_id,p_store_id,p_order_id,v_actor);
  ELSIF p_expected='accepted' AND p_next='cancelled' THEN
    v_stock_count:=rcat_private._return_order_stock(
      p_tenant_id,p_store_id,p_order_id,v_actor);
  END IF;

  UPDATE rcat.orders SET status=p_next,updated_at=clock_timestamp()
    WHERE id=v_order.id;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata)
  VALUES(p_tenant_id,v_actor,'order.status.changed',v_order.id,
    jsonb_build_object('storeId',p_store_id,'from',p_expected,'to',p_next));
  RETURN jsonb_build_object(
    'orderId',v_order.id,'status',p_next,
    'amountSatang',v_order.amount_satang,'currency',v_order.currency,
    'paymentState',v_order.payment_state,
    'inventoryMovementCount',v_stock_count);
END $$;

-- Guest mutation is authorized by the per-person Store QR token digest ONLY,
-- never by the printed Store QR, public Order UUID or tracking token.
-- Exactly-once per session+idempotency key; status CAS and increment are
-- serialized with Merchant Accepted -> Preparing by the same Order row lock.
CREATE FUNCTION rcat_private.quick_order_submit(
  p_digest bytea,p_idempotency_key text,p_cart jsonb,
  p_requested_order uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
 v_guest rcat_private.store_guest_sessions%ROWTYPE;
 v_existing rcat_private.quick_order_actions%ROWTYPE;
 v_order rcat.orders%ROWTYPE;
 v_order_id uuid;v_action text;v_lines jsonb;
 v_amount bigint;v_total bigint;v_count bigint;
 v_new_ids uuid[];v_tracking text;v_stock_count integer:=0;
BEGIN
  IF p_digest IS NULL OR octet_length(p_digest)<>32
    OR p_idempotency_key IS NULL
    OR length(p_idempotency_key) NOT BETWEEN 16 AND 96
    OR p_idempotency_key !~ '^[A-Za-z0-9_-]+$'
  THEN RAISE EXCEPTION 'Quick Order unavailable' USING ERRCODE='42501'; END IF;
  IF p_cart IS NULL OR jsonb_typeof(p_cart)<>'object'
    OR jsonb_typeof(p_cart->'items')<>'array'
    OR jsonb_array_length(p_cart->'items') NOT BETWEEN 1 AND 20
    OR jsonb_typeof(p_cart->'orderedBy') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_cart->'deliverTo') IS DISTINCT FROM 'string'
    OR length(btrim(p_cart->>'orderedBy')) NOT BETWEEN 1 AND 80
    OR length(btrim(p_cart->>'deliverTo')) NOT BETWEEN 1 AND 160
    OR (p_cart->>'orderedBy')~'[[:cntrl:]]'
    OR (p_cart->>'deliverTo')~'[[:cntrl:]]'
  THEN RAISE EXCEPTION 'Invalid Quick Order' USING ERRCODE='22023'; END IF;

  -- Validate ownership before locating store row; store lock is the first
  -- write lock, followed by order, ingredients and transactional Outbox.
  SELECT * INTO v_guest FROM rcat_private.store_guest_sessions g
  WHERE g.token_digest=p_digest AND g.revoked_at IS NULL
    AND g.expires_at>clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quick session unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM rcat.stores s
  WHERE s.tenant_id=v_guest.tenant_id AND s.id=v_guest.store_id
    AND s.ordering_enabled FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quick session unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM rcat_private.store_guest_sessions g
    JOIN rcat_private.store_public_qrs q
      ON q.tenant_id=g.tenant_id AND q.store_id=g.store_id
      AND q.generation=g.qr_generation
    JOIN rcat_private.store_service_modes m
      ON m.tenant_id=g.tenant_id AND m.store_id=g.store_id
      AND m.revision=g.mode_revision
    WHERE g.id=v_guest.id AND g.token_digest=p_digest
      AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
      AND m.service_mode IN ('quick','hybrid')
    FOR SHARE OF g;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quick session unavailable' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_existing FROM rcat_private.quick_order_actions a
  WHERE a.session_id=v_guest.id AND a.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_data IS DISTINCT FROM p_cart
      OR v_existing.requested_order_id IS DISTINCT FROM p_requested_order THEN
      RAISE EXCEPTION 'Idempotency key reused with changed Order'
        USING ERRCODE='23505';
    END IF;
    SELECT * INTO v_order FROM rcat.orders WHERE id=v_existing.result_order_id;
    RETURN jsonb_build_object(
      'orderId',v_order.id,'displayNumber',v_order.display_number::text,
      'amountSatang',v_order.amount_satang,
      'addedSatang',v_existing.added_satang,
      'currency',v_order.currency,'status',v_order.status,
      'paymentState',v_order.payment_state,
      'action',v_existing.action,'replayed',true
    );
  END IF;
  SELECT count(*) INTO v_count FROM rcat_private.quick_order_actions
  WHERE session_id=v_guest.id;
  IF v_count>=100 THEN
    RAISE EXCEPTION 'Too many Quick Order actions'
      USING ERRCODE='P0041';
  END IF;
  v_order_id:=NULL;
  IF p_requested_order IS NOT NULL THEN
    SELECT * INTO v_order FROM rcat.orders o
    WHERE o.id=p_requested_order AND o.tenant_id=v_guest.tenant_id
      AND o.store_id=v_guest.store_id AND o.quick_session_id=v_guest.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quick Order unavailable' USING ERRCODE='42501';
    END IF;
    IF v_order.status IN ('submitted','accepted')
      AND v_order.payment_state='not_requested'
      AND NOT EXISTS(SELECT 1 FROM rcat.payment_requests pay
        WHERE pay.tenant_id=v_guest.tenant_id
          AND pay.store_id=v_guest.store_id AND pay.order_id=v_order.id)
    THEN v_order_id:=v_order.id;v_action:='appended';
    ELSE v_action:='new_after_cutoff';
    END IF;
  ELSE v_action:='created';
  END IF;

  IF v_order_id IS NULL THEN
    INSERT INTO rcat.orders(
      tenant_id,store_id,table_id,visit_id,quick_session_id,
      idempotency_key,request_data,ordered_by,deliver_to
    ) VALUES(
      v_guest.tenant_id,v_guest.store_id,NULL,NULL,v_guest.id,
      p_idempotency_key,p_cart,btrim(p_cart->>'orderedBy'),
      btrim(p_cart->>'deliverTo')
    ) RETURNING id INTO v_order_id;
  END IF;

  -- Pricing is entirely server-side, including modifier availability,
  -- required options, quantity and notes. A failed row rolls everything back.
  v_lines:=rcat_private._quick_insert_lines(
    v_guest.tenant_id,v_guest.store_id,v_order_id,p_cart);
  v_amount:=(v_lines->>'addedSatang')::bigint;
  SELECT array_agg(value::uuid) INTO v_new_ids
  FROM jsonb_array_elements_text(v_lines->'itemIds');
  SELECT coalesce(sum(quantity),0),coalesce(sum(line_total_satang),0)
  INTO v_count,v_total FROM rcat.order_items
  WHERE order_id=v_order_id AND tenant_id=v_guest.tenant_id
    AND store_id=v_guest.store_id;
  IF v_count>100 OR v_total>100000000 THEN
    RAISE EXCEPTION 'Quick Order exceeds limits' USING ERRCODE='22023';
  END IF;

  IF v_action='appended' AND v_order.status='accepted' THEN
    v_stock_count:=rcat_private._quick_allocate_accepted_addon(
      v_guest.tenant_id,v_guest.store_id,v_order_id,v_new_ids);
  END IF;
  UPDATE rcat.orders SET amount_satang=v_total,
    updated_at=clock_timestamp()
  WHERE id=v_order_id AND tenant_id=v_guest.tenant_id
    AND store_id=v_guest.store_id;
  INSERT INTO rcat_private.quick_order_actions(
    session_id,idempotency_key,requested_order_id,request_data,
    result_order_id,action,added_satang
  ) VALUES(
    v_guest.id,p_idempotency_key,p_requested_order,p_cart,
    v_order_id,v_action,v_amount
  );
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata
  ) VALUES(
    v_guest.tenant_id,NULL,'order.quick.'||v_action,v_order_id,
    jsonb_build_object(
      'storeId',v_guest.store_id,'guestSessionId',v_guest.id,
      'addedSatang',v_amount,'totalSatang',v_total,
      'previousOrderId',p_requested_order,
      'inventoryMovementCount',v_stock_count,
      'paymentVerified',false)
  );
  RETURN jsonb_build_object(
    'orderId',v_order_id,'displayNumber',
      (SELECT display_number::text FROM rcat.orders WHERE id=v_order_id),
    'amountSatang',v_total,'addedSatang',v_amount,
    'currency','THB','status',
      (SELECT status FROM rcat.orders WHERE id=v_order_id),
    'paymentState','not_requested',
    'action',v_action,'replayed',false
  );
END $$;
REVOKE ALL ON FUNCTION rcat_private.quick_order_submit(
  bytea,text,jsonb,uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.quick_order_submit(
  bytea,text,jsonb,uuid
) TO rcat_auth;

-- Non-enumerating, session-only read for customer-owned counter Orders.
CREATE FUNCTION rcat_private.quick_order_my_orders(p_digest bytea)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_guest rcat_private.store_guest_sessions%ROWTYPE;
BEGIN
  IF p_digest IS NULL OR octet_length(p_digest)<>32 THEN
    RAISE EXCEPTION 'Quick session unavailable' USING ERRCODE='42501';
  END IF;
  SELECT g.* INTO v_guest FROM rcat_private.store_guest_sessions g
  JOIN rcat.stores s ON s.tenant_id=g.tenant_id AND s.id=g.store_id
  JOIN rcat_private.store_public_qrs q
    ON q.tenant_id=g.tenant_id AND q.store_id=g.store_id
    AND q.generation=g.qr_generation
  JOIN rcat_private.store_service_modes m
    ON m.tenant_id=g.tenant_id AND m.store_id=g.store_id
    AND m.revision=g.mode_revision AND m.service_mode IN('quick','hybrid')
  WHERE g.token_digest=p_digest AND g.revoked_at IS NULL
    AND g.expires_at>clock_timestamp() AND s.ordering_enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quick session unavailable' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('guestSessionId',v_guest.id,
    'orders',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'orderId',o.id,'displayNumber',o.display_number::text,
        'status',o.status,'paymentState',o.payment_state,
        'amountSatang',o.amount_satang,'currency',o.currency,
        'createdAt',o.created_at,'updatedAt',o.updated_at,
        'items',(SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name',i.product_name,'quantity',i.quantity,
          'unitPriceSatang',i.unit_price_satang,
          'lineTotalSatang',i.line_total_satang,
          'options',i.option_snapshots,
          'note',i.special_instructions
        ) ORDER BY i.created_at,i.id),'[]'::jsonb)
        FROM rcat.order_items i
        WHERE i.tenant_id=o.tenant_id AND i.store_id=o.store_id
          AND i.order_id=o.id)
      ) ORDER BY o.created_at,o.id),'[]'::jsonb)
      FROM (SELECT * FROM rcat.orders
        WHERE quick_session_id=v_guest.id AND tenant_id=v_guest.tenant_id
          AND store_id=v_guest.store_id
        ORDER BY created_at DESC,id DESC LIMIT 50) o
    ),'[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION rcat_private.quick_order_my_orders(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.quick_order_my_orders(bytea)
 TO rcat_auth;
