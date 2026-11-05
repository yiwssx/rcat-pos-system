-- G2 #38: a permanent printed QR holds public table IDs only.
-- Staff disclose a fresh 8-digit code per visit, NEVER the master visit secret.
-- Grant tokens are distinct 256-bit per-client bearer secrets, not QR payloads.
ALTER TABLE rcat.table_ordering_visits
  ADD COLUMN code_digest bytea CHECK(code_digest IS NULL OR octet_length(code_digest)=32),
  ADD COLUMN code_failed_attempts integer NOT NULL DEFAULT 0
    CHECK(code_failed_attempts BETWEEN 0 AND 12),
  ADD COLUMN code_window_started_at timestamptz;

CREATE TABLE rcat.table_guest_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES rcat.table_ordering_visits(id) ON DELETE RESTRICT,
  token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '6 hours')
);
CREATE INDEX table_guest_grants_visit_idx
  ON rcat.table_guest_grants(visit_id,expires_at);
ALTER TABLE rcat.table_guest_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.table_guest_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.table_guest_grants FROM PUBLIC,rcat_app,rcat_auth;

CREATE FUNCTION rcat_private.list_printable_tables(
  p_digest bytea,p_tenant uuid,p_store uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
 PERFORM rcat_private._catalog_actor(p_digest,p_tenant,p_store,false);
 RETURN jsonb_build_object('tables',coalesce((
  SELECT jsonb_agg(jsonb_build_object(
    'tableId',t.id,'label',t.label,'active',t.active,
    'codeExpiresAt',v.expires_at)
    ORDER BY t.label,t.id)
  FROM rcat.store_tables t
  LEFT JOIN rcat.table_ordering_visits v
    ON v.table_id=t.id AND v.tenant_id=t.tenant_id
      AND v.store_id=t.store_id AND v.revoked_at IS NULL
      AND v.code_digest IS NOT NULL AND v.expires_at>now()
  WHERE t.tenant_id=p_tenant AND t.store_id=p_store
 ),'[]'::jsonb));
END $$;

CREATE FUNCTION rcat_private.printable_table_detail(
 p_digest bytea,p_tenant uuid,p_store uuid,p_table uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_label text;v_store_name text;
BEGIN
 PERFORM rcat_private._catalog_actor(p_digest,p_tenant,p_store,false);
 SELECT t.label,s.display_name INTO v_label,v_store_name
 FROM rcat.store_tables t JOIN rcat.stores s
   ON s.tenant_id=t.tenant_id AND s.id=t.store_id
 WHERE t.tenant_id=p_tenant AND t.store_id=p_store
   AND t.id=p_table AND t.active;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Table unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('tableId',p_table,'label',v_label,'storeName',v_store_name);
END $$;

CREATE FUNCTION rcat_private.issue_table_code(
 p_digest bytea,p_tenant uuid,p_store uuid,p_table uuid,
 p_master_digest bytea,p_code_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_visit uuid;v_expiry timestamptz;v_actor uuid;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant,p_store,true);
 IF p_code_digest IS NULL OR octet_length(p_code_digest)<>32 THEN
   RAISE EXCEPTION 'Invalid table code' USING ERRCODE='22023'; END IF;
 SELECT visit_id,expires_at INTO v_visit,v_expiry
  FROM rcat_private.rotate_ordering_visit(
    p_digest,p_tenant,p_store,p_table,p_master_digest);
 UPDATE rcat.table_ordering_visits
 SET code_digest=p_code_digest,
     code_failed_attempts=0,code_window_started_at=NULL
 WHERE id=v_visit;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id)
 VALUES(p_tenant,v_actor,'table.code.issued',v_visit);
 RETURN jsonb_build_object('visitId',v_visit,'expiresAt',v_expiry);
END $$;

-- Failed attempts are committed as normal results so they survive the
-- API's HTTP 404 response. Locking prevents concurrent guesses bypassing 12.
CREATE FUNCTION rcat_private.redeem_table_code(
 p_tenant uuid,p_store uuid,p_table uuid,p_code_digest bytea,p_guest_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v rcat.table_ordering_visits%ROWTYPE;v_count integer;
  v_window timestamptz;v_time timestamptz:=clock_timestamp();
BEGIN
 IF p_tenant IS NULL OR p_store IS NULL OR p_table IS NULL
   OR p_code_digest IS NULL OR octet_length(p_code_digest)<>32
   OR p_guest_digest IS NULL OR octet_length(p_guest_digest)<>32 THEN
   RETURN jsonb_build_object('ok',false); END IF;
 SELECT visit.* INTO v
 FROM rcat.table_ordering_visits visit
 JOIN rcat.store_tables t ON t.id=visit.table_id
   AND t.tenant_id=visit.tenant_id AND t.store_id=visit.store_id
 WHERE visit.tenant_id=p_tenant AND visit.store_id=p_store
   AND visit.table_id=p_table AND visit.revoked_at IS NULL
   AND visit.expires_at>v_time AND visit.code_digest IS NOT NULL
   AND t.active
 FOR UPDATE OF visit;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false); END IF;
 v_count:=CASE WHEN v.code_window_started_at IS NULL OR
   v.code_window_started_at<v_time-interval '10 minutes'
   THEN 0 ELSE v.code_failed_attempts END;
 v_window:=CASE WHEN v_count=0 THEN v_time
   ELSE v.code_window_started_at END;
 IF v_count>=12 THEN RETURN jsonb_build_object('ok',false); END IF;
 IF v.code_digest IS DISTINCT FROM p_code_digest THEN
   UPDATE rcat.table_ordering_visits
   SET code_failed_attempts=v_count+1,
       code_window_started_at=v_window
   WHERE id=v.id;
   RETURN jsonb_build_object('ok',false);
 END IF;
 -- Bounded number of guest devices per visit; all grants are revoked
 -- implicitly when the parent visit is rotated or expires.
 SELECT count(*) INTO v_count FROM rcat.table_guest_grants
   WHERE visit_id=v.id;
 IF v_count>=200 THEN RETURN jsonb_build_object('ok',false); END IF;
 INSERT INTO rcat.table_guest_grants(visit_id,token_digest,expires_at)
 VALUES(v.id,p_guest_digest,v.expires_at);
 UPDATE rcat.table_ordering_visits
 SET code_failed_attempts=0,code_window_started_at=NULL
 WHERE id=v.id;
 RETURN jsonb_build_object('ok',true,'expiresAt',v.expires_at);
END $$;

REVOKE ALL ON FUNCTION rcat_private.list_printable_tables(bytea,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.printable_table_detail(bytea,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.issue_table_code(bytea,uuid,uuid,uuid,bytea,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.redeem_table_code(uuid,uuid,uuid,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.list_printable_tables(bytea,uuid,uuid) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.printable_table_detail(bytea,uuid,uuid,uuid) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.issue_table_code(bytea,uuid,uuid,uuid,bytea,bytea) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.redeem_table_code(uuid,uuid,uuid,bytea,bytea) TO rcat_auth;

-- Both existing high-entropy staff visit links and independently redeemed
-- guest token digests retain the original Order/Guest UX and idempotency.

CREATE OR REPLACE FUNCTION rcat_private.resolve_ordering_visit(p_token_digest bytea)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v rcat.table_ordering_visits%ROWTYPE;t_label text;s_name text;
BEGIN
 IF p_token_digest IS NULL OR octet_length(p_token_digest)<>32 THEN
    RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501'; END IF;
 SELECT visit.* INTO v FROM rcat.table_ordering_visits visit
 JOIN rcat.store_tables tab ON tab.id=visit.table_id
   AND tab.tenant_id=visit.tenant_id AND tab.store_id=visit.store_id
 WHERE (
   visit.token_digest=p_token_digest OR EXISTS(
     SELECT 1 FROM rcat.table_guest_grants grant
     WHERE grant.visit_id=visit.id AND grant.token_digest=p_token_digest
       AND grant.expires_at>now()
   )
 ) AND visit.revoked_at IS NULL
   AND visit.expires_at>now() AND tab.active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501'; END IF;
 SELECT t.label,s.display_name INTO t_label,s_name
  FROM rcat.store_tables t
  JOIN rcat.stores s ON s.id=t.store_id AND s.tenant_id=t.tenant_id
 WHERE t.id=v.table_id AND t.tenant_id=v.tenant_id AND t.store_id=v.store_id;
 RETURN jsonb_build_object(
   'visitId',v.id,'storeId',v.store_id,'tableId',v.table_id,
   'tableLabel',t_label,'storeName',s_name,'expiresAt',v.expires_at,
   'categories',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug)
        ORDER BY c.sort_order,c.slug)
      FROM rcat.menu_categories c WHERE c.tenant_id=v.tenant_id
       AND c.store_id=v.store_id
   ),'[]'::jsonb),
   'modifierGroups',COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'id',g.id,'productId',g.product_id,'slug',g.slug,
     'name',g.name,'minSelect',g.min_select,'maxSelect',g.max_select)
     ORDER BY g.sort_order,g.slug)
   FROM rcat.menu_modifier_groups g
   JOIN rcat.menu_products mp ON mp.id=g.product_id
     AND mp.tenant_id=g.tenant_id AND mp.store_id=g.store_id
   WHERE g.tenant_id=v.tenant_id AND g.store_id=v.store_id
     AND mp.available
 ),'[]'::jsonb),
 'modifierOptions',COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'id',o.id,'productId',o.product_id,'groupId',o.group_id,
     'name',o.name,'priceDeltaSatang',o.price_delta_satang)
     ORDER BY o.sort_order,o.name)
   FROM rcat.menu_modifier_options o
   JOIN rcat.menu_products mp ON mp.id=o.product_id
      AND mp.tenant_id=o.tenant_id AND mp.store_id=o.store_id
   WHERE o.tenant_id=v.tenant_id AND o.store_id=v.store_id
     AND o.available AND mp.available
 ),'[]'::jsonb),
 'products',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
        'categoryId',p.category_id,'priceSatang',p.price_satang)
        ORDER BY p.created_at,p.id)
      FROM rcat.menu_products p WHERE p.tenant_id=v.tenant_id
        AND p.store_id=v.store_id AND p.available
   ),'[]'::jsonb)
 );
END $$;

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
 WHERE (
   visit.token_digest=p_visit_digest OR EXISTS(
     SELECT 1 FROM rcat.table_guest_grants grant
     WHERE grant.visit_id=visit.id AND grant.token_digest=p_visit_digest
       AND grant.expires_at>now()
   )
 ) AND visit.revoked_at IS NULL
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
