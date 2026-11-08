-- G2 public guest safety: store-scoped keyset catalog + atomic cross-instance
-- request budgets. No Payment routes or direct rcat_auth table privileges.
CREATE TABLE rcat_private.guest_request_budgets (
  lane text NOT NULL,
  subject bytea NOT NULL CHECK(octet_length(subject)=32),
  window_started timestamptz NOT NULL,
  hits integer NOT NULL CHECK(hits BETWEEN 1 AND 10000),
  PRIMARY KEY(lane,subject,window_started)
);
CREATE INDEX guest_request_budgets_window_idx
  ON rcat_private.guest_request_budgets(window_started);
REVOKE ALL ON rcat_private.guest_request_budgets FROM PUBLIC,rcat_app,rcat_auth;

CREATE FUNCTION rcat_private.claim_guest_request_budget(
  p_lane text,p_subject bytea
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_limit integer;v_seconds integer;v_window timestamptz;v_hits integer;
BEGIN
 IF p_subject IS NULL OR octet_length(p_subject)<>32 THEN
   RAISE EXCEPTION 'Invalid rate budget identity' USING ERRCODE='22023';
 END IF;
 -- The caller can choose only a fixed lane, never a higher quota.
 SELECT max_hits,window_seconds INTO v_limit,v_seconds
 FROM (VALUES
  ('redeem-ip',30,300),('redeem-token',60,300),
  ('resolve-ip',300,60),('resolve-token',120,60),
  ('page-ip',300,60),('page-token',120,60),
  ('checkout-ip',600,60),('checkout-token',150,60),
  ('tracking-ip',600,60),('tracking-token',180,60)
 ) AS policy(lane,max_hits,window_seconds)
 WHERE policy.lane=p_lane;
 IF v_limit IS NULL THEN
   RAISE EXCEPTION 'Unknown rate budget lane' USING ERRCODE='22023';
 END IF;
 v_window:=to_timestamp(
   floor(extract(epoch FROM clock_timestamp())/v_seconds)*v_seconds
 );
 INSERT INTO rcat_private.guest_request_budgets(lane,subject,window_started,hits)
 VALUES(p_lane,p_subject,v_window,1)
 ON CONFLICT (lane,subject,window_started) DO UPDATE
 SET hits=rcat_private.guest_request_budgets.hits+1
 WHERE rcat_private.guest_request_budgets.hits<v_limit
 RETURNING hits INTO v_hits;
 RETURN v_hits IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION rcat_private.claim_guest_request_budget(text,bytea)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.claim_guest_request_budget(text,bytea)
  TO rcat_auth;

-- Run via restricted maintenance role/scheduler; do not run a full-table
-- DELETE on each public request. Operational gate: daily cleanup.
CREATE FUNCTION rcat_private.prune_guest_request_budgets()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_count bigint;
BEGIN
 DELETE FROM rcat_private.guest_request_budgets
 WHERE window_started<clock_timestamp()-interval '1 day';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION rcat_private.prune_guest_request_budgets() FROM PUBLIC;
-- No rcat_auth/rcat_app grants: housekeeping is a DBA/scheduler action.

CREATE FUNCTION rcat_private.guest_catalog_page(
 p_digest bytea,p_search text,p_category uuid,
 p_after_created timestamptz,p_after_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
 v rcat.table_ordering_visits%ROWTYPE;
 v_table_label text;
 v_store_name text;
 v_products jsonb;
 v_categories jsonb;
 v_groups jsonb;
 v_options jsonb;
 v_has_more boolean;
 v_last_created timestamptz;
 v_last_id uuid;
BEGIN
 IF p_digest IS NULL OR octet_length(p_digest)<>32 THEN
   RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501';
 END IF;
 IF p_search IS NULL OR length(btrim(p_search))>80 OR
    p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR
    (p_after_created IS NULL)<>(p_after_id IS NULL) THEN
   RAISE EXCEPTION 'Invalid guest catalog page' USING ERRCODE='22023';
 END IF;
 SELECT visit.* INTO v
 FROM rcat.table_ordering_visits visit
 JOIN rcat.store_tables tab ON tab.id=visit.table_id
   AND tab.tenant_id=visit.tenant_id AND tab.store_id=visit.store_id
 WHERE (visit.token_digest=p_digest OR EXISTS(
   SELECT 1 FROM rcat.table_guest_grants g
   WHERE g.visit_id=visit.id AND g.token_digest=p_digest
     AND g.expires_at>now()
 )) AND visit.revoked_at IS NULL AND visit.expires_at>now()
   AND tab.active;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501';
 END IF;
 SELECT tab.label,store.display_name INTO v_table_label,v_store_name
 FROM rcat.store_tables tab
 JOIN rcat.stores store ON store.tenant_id=tab.tenant_id
   AND store.id=tab.store_id
 WHERE tab.id=v.table_id AND tab.tenant_id=v.tenant_id
   AND tab.store_id=v.store_id;

 WITH matched AS MATERIALIZED (
  SELECT p.* FROM rcat.menu_products p
  WHERE p.tenant_id=v.tenant_id AND p.store_id=v.store_id
   AND p.available AND p.archived_at IS NULL
   AND (p_category IS NULL OR p.category_id=p_category)
   AND (btrim(p_search)='' OR strpos(lower(p.name),lower(btrim(p_search)))>0)
   AND (p_after_id IS NULL OR
     (p.created_at,p.id)>(p_after_created,p_after_id))
  ORDER BY p.created_at,p.id LIMIT p_limit+1
 ), visible AS MATERIALIZED (
  SELECT * FROM matched ORDER BY created_at,id LIMIT p_limit
 )
 SELECT COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.name,'categoryId',p.category_id,
     'priceSatang',p.price_satang,
     'hasImage',EXISTS(SELECT 1 FROM rcat.menu_product_media m
       WHERE m.tenant_id=p.tenant_id AND m.store_id=p.store_id
         AND m.product_id=p.id))
     ORDER BY p.created_at,p.id)
   FROM visible p
 ),'[]'::jsonb),
 (SELECT count(*)>p_limit FROM matched),
 (SELECT p.created_at FROM visible p ORDER BY p.created_at DESC,p.id DESC LIMIT 1),
 (SELECT p.id FROM visible p ORDER BY p.created_at DESC,p.id DESC LIMIT 1)
 INTO v_products,v_has_more,v_last_created,v_last_id;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',c.id,'name',c.name,'slug',c.slug) ORDER BY c.sort_order,c.slug),
   '[]'::jsonb) INTO v_categories
 FROM rcat.menu_categories c
 WHERE c.tenant_id=v.tenant_id AND c.store_id=v.store_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',g.id,'productId',g.product_id,'slug',g.slug,'name',g.name,
   'minSelect',g.min_select,'maxSelect',g.max_select)
   ORDER BY g.sort_order,g.slug),'[]'::jsonb) INTO v_groups
 FROM rcat.menu_modifier_groups g
 WHERE g.tenant_id=v.tenant_id AND g.store_id=v.store_id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_products) item
     WHERE (item->>'id')::uuid=g.product_id);
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',o.id,'productId',o.product_id,'groupId',o.group_id,
   'name',o.name,'priceDeltaSatang',o.price_delta_satang)
   ORDER BY o.sort_order,o.name),'[]'::jsonb) INTO v_options
 FROM rcat.menu_modifier_options o
 WHERE o.tenant_id=v.tenant_id AND o.store_id=v.store_id AND o.available
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_products) item
     WHERE (item->>'id')::uuid=o.product_id);

 RETURN jsonb_build_object(
  'visitId',v.id,'tenantId',v.tenant_id,'storeId',v.store_id,
  'tableId',v.table_id,'tableLabel',v_table_label,
  'storeName',v_store_name,'expiresAt',v.expires_at,
  'categories',v_categories,'products',v_products,
  'modifierGroups',v_groups,'modifierOptions',v_options,
  'hasMore',v_has_more,
  'nextCursor',CASE WHEN v_has_more THEN jsonb_build_object(
    'createdAt',v_last_created,'id',v_last_id) ELSE NULL END
 );
END $$;
REVOKE ALL ON FUNCTION rcat_private.guest_catalog_page(
 bytea,text,uuid,timestamptz,uuid,integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.guest_catalog_page(
 bytea,text,uuid,timestamptz,uuid,integer
) TO rcat_auth;
