-- G2/G4: bound checkout preflight to selected cart products/options.
-- Never trust client totals. This is a *read-only review snapshot*, not
-- an Order or inventory reservation. Checkout still locks/validates independently.
CREATE FUNCTION rcat_private.guest_cart_review(
 p_digest bytea,p_product_ids uuid[],p_selected_options uuid[]
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
BEGIN
 IF p_digest IS NULL OR octet_length(p_digest)<>32 THEN
  RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501';
 END IF;
 IF p_product_ids IS NULL OR cardinality(p_product_ids) NOT BETWEEN 1 AND 20
    OR array_position(p_product_ids,NULL) IS NOT NULL
    OR p_selected_options IS NULL OR cardinality(p_selected_options)>640
    OR array_position(p_selected_options,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Invalid cart review' USING ERRCODE='22023';
 END IF;
 SELECT visit.* INTO v
 FROM rcat.table_ordering_visits visit
 JOIN rcat.store_tables tab ON tab.id=visit.table_id
  AND tab.tenant_id=visit.tenant_id AND tab.store_id=visit.store_id
 WHERE (visit.token_digest=p_digest OR EXISTS (
   SELECT 1 FROM rcat.table_guest_grants g
   WHERE g.visit_id=visit.id AND g.token_digest=p_digest
    AND g.expires_at>now()
 )) AND visit.revoked_at IS NULL AND visit.expires_at>now()
   AND tab.active;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501';
 END IF;

 SELECT tab.label,s.display_name INTO v_table_label,v_store_name
 FROM rcat.store_tables tab
 JOIN rcat.stores s ON s.id=tab.store_id AND s.tenant_id=tab.tenant_id
 WHERE tab.id=v.table_id AND tab.tenant_id=v.tenant_id
   AND tab.store_id=v.store_id;

 -- Only products present and currently orderable. Missing items stay
 -- absent so the browser explicitly requests cart reconfirmation/removal.
 WITH chosen AS MATERIALIZED (
   SELECT p.* FROM rcat.menu_products p
   WHERE p.tenant_id=v.tenant_id AND p.store_id=v.store_id
    AND p.id=ANY(p_product_ids) AND p.available AND p.archived_at IS NULL
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',p.id,'name',p.name,'categoryId',p.category_id,
   'priceSatang',p.price_satang,
   'hasImage',EXISTS(SELECT 1 FROM rcat.menu_product_media m
    WHERE m.tenant_id=p.tenant_id AND m.store_id=p.store_id
     AND m.product_id=p.id)) ORDER BY p.created_at,p.id),
   '[]'::jsonb) INTO v_products
 FROM chosen p;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',c.id,'name',c.name,'slug',c.slug) ORDER BY c.sort_order,c.slug),
  '[]'::jsonb) INTO v_categories
 FROM rcat.menu_categories c
 WHERE c.tenant_id=v.tenant_id AND c.store_id=v.store_id
  AND EXISTS (SELECT 1 FROM rcat.menu_products p
    WHERE p.id=ANY(p_product_ids) AND p.category_id=c.id
      AND p.tenant_id=v.tenant_id AND p.store_id=v.store_id
      AND p.available AND p.archived_at IS NULL);

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',g.id,'productId',g.product_id,'slug',g.slug,'name',g.name,
   'minSelect',g.min_select,'maxSelect',g.max_select)
   ORDER BY g.sort_order,g.slug),'[]'::jsonb) INTO v_groups
 FROM rcat.menu_modifier_groups g
 WHERE g.tenant_id=v.tenant_id AND g.store_id=v.store_id
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_products) product
   WHERE (product->>'id')::uuid=g.product_id);

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',o.id,'productId',o.product_id,'groupId',o.group_id,
  'name',o.name,'priceDeltaSatang',o.price_delta_satang)
  ORDER BY o.sort_order,o.name),'[]'::jsonb) INTO v_options
 FROM rcat.menu_modifier_options o
 WHERE o.tenant_id=v.tenant_id AND o.store_id=v.store_id
  AND o.available AND o.id=ANY(p_selected_options)
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_products) product
   WHERE (product->>'id')::uuid=o.product_id);

 RETURN jsonb_build_object(
  'visitId',v.id,'tenantId',v.tenant_id,'storeId',v.store_id,
  'tableId',v.table_id,'tableLabel',v_table_label,
  'storeName',v_store_name,'expiresAt',v.expires_at,
  'categories',v_categories,'products',v_products,
  'modifierGroups',v_groups,'modifierOptions',v_options
 );
END $$;
REVOKE ALL ON FUNCTION rcat_private.guest_cart_review(
  bytea,uuid[],uuid[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.guest_cart_review(
  bytea,uuid[],uuid[]
) TO rcat_auth;
