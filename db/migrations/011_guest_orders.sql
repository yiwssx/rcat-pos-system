-- G2 Order Engine baseline: one Order represents one separate future payment
-- obligation. No payment provider, payment attempt or PromptPay QR exists.
CREATE TABLE rcat.orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 store_id uuid NOT NULL,
 table_id uuid NOT NULL,
 visit_id uuid NOT NULL,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 96),
 request_data jsonb NOT NULL,
 amount_satang bigint NOT NULL DEFAULT 0 CHECK(amount_satang BETWEEN 0 AND 100000000),
 currency text NOT NULL DEFAULT 'THB' CHECK(currency='THB'),
 status text NOT NULL DEFAULT 'submitted'
   CHECK(status IN ('submitted','accepted','preparing','served','cancelled')),
 payment_state text NOT NULL DEFAULT 'not_requested'
   CHECK(payment_state='not_requested'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,store_id,id),
 UNIQUE(visit_id,idempotency_key),
 FOREIGN KEY(tenant_id,store_id,table_id) REFERENCES rcat.store_tables
   (tenant_id,store_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(visit_id) REFERENCES rcat.table_ordering_visits(id) ON DELETE RESTRICT
);
CREATE INDEX orders_store_time_idx ON rcat.orders(tenant_id,store_id,created_at DESC);

CREATE TABLE rcat.order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 store_id uuid NOT NULL,
 order_id uuid NOT NULL,
 product_id uuid NOT NULL,
 product_name text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),
 base_price_satang bigint NOT NULL,
 unit_price_satang bigint NOT NULL CHECK(unit_price_satang BETWEEN 1 AND 100000000),
 line_total_satang bigint NOT NULL CHECK(line_total_satang BETWEEN 1 AND 100000000),
 option_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb
   CHECK(jsonb_typeof(option_snapshots)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,store_id,order_id) REFERENCES rcat.orders
   (tenant_id,store_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,store_id,product_id) REFERENCES rcat.menu_products
   (tenant_id,store_id,id) ON DELETE RESTRICT
);
CREATE INDEX order_items_order_idx ON rcat.order_items(tenant_id,store_id,order_id);

ALTER TABLE rcat.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY orders_tenant_read ON rcat.orders FOR SELECT TO rcat_app
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY order_items_tenant_read ON rcat.order_items FOR SELECT TO rcat_app
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT ON rcat.orders,rcat.order_items TO rcat_app;

-- One SQL transaction is the authority for an Order and immutable snapshots.
-- Lock table row FOR SHARE so a concurrent visit rotation (FOR UPDATE) cannot
-- invalidate a guest token midway through checkout.
CREATE FUNCTION rcat_private.place_guest_order(
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
   tenant_id,store_id,table_id,visit_id,idempotency_key,request_data
 ) VALUES(
   v_visit.tenant_id,v_visit.store_id,v_visit.table_id,v_visit.id,
   p_idempotency_key,p_cart
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
     option_snapshots
   ) VALUES(
     v_visit.tenant_id,v_visit.store_id,v_order_id,v_pid,v_product.name,
     v_qty,v_product.price_satang,v_unit,v_line_total,v_snapshots
   );
 END LOOP;
 UPDATE rcat.orders SET amount_satang=v_amount WHERE id=v_order_id;
 RETURN jsonb_build_object(
   'orderId',v_order_id,'amountSatang',v_amount,'currency','THB',
   'status','submitted','paymentState','not_requested','replayed',false
 );
END $$;

REVOKE ALL ON FUNCTION rcat_private.place_guest_order(bytea,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.place_guest_order(bytea,text,jsonb) TO rcat_auth;
