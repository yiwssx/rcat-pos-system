-- D / #102: bounded Store Guest menu page and selected-cart review.
-- Reuse the Table pricing/catalog shape, NOT Table Visit authorization.
CREATE FUNCTION rcat_private.quick_guest_catalog_page(
 p_digest bytea,p_search text,p_category uuid,
 p_after_created timestamptz,p_after_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
 v rcat_private.store_guest_sessions%ROWTYPE;
 v_identity jsonb;
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
 -- Validate the private counter capability. Public IDs and Table tokens
 -- cannot authorize this read. The resolver locks the store for sharing.
 v_identity:=rcat_private.resolve_store_guest_session(p_digest);
 SELECT g.* INTO STRICT v FROM rcat_private.store_guest_sessions g
 WHERE g.id=(v_identity->>'guestSessionId')::uuid
 AND g.token_digest=p_digest AND g.revoked_at IS NULL
 AND g.expires_at>clock_timestamp();

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

 RETURN v_identity||jsonb_build_object(
  'categories',v_categories,'products',v_products,
  'modifierGroups',v_groups,'modifierOptions',v_options,
  'hasMore',v_has_more,
  'nextCursor',CASE WHEN v_has_more THEN jsonb_build_object(
    'createdAt',v_last_created,'id',v_last_id) ELSE NULL END
 );
END $$;
REVOKE ALL ON FUNCTION rcat_private.quick_guest_catalog_page(bytea,text,uuid,timestamptz,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.quick_guest_catalog_page(bytea,text,uuid,timestamptz,uuid,integer) TO rcat_auth;

CREATE FUNCTION rcat_private.quick_guest_cart_review(
 p_digest bytea,p_product_ids uuid[],p_selected_options uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
 v rcat_private.store_guest_sessions%ROWTYPE;
 v_identity jsonb;
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
 -- Validate the private counter capability. Public IDs and Table tokens
 -- cannot authorize this read. The resolver locks the store for sharing.
 v_identity:=rcat_private.resolve_store_guest_session(p_digest);
 SELECT g.* INTO STRICT v FROM rcat_private.store_guest_sessions g
 WHERE g.id=(v_identity->>'guestSessionId')::uuid
 AND g.token_digest=p_digest AND g.revoked_at IS NULL
 AND g.expires_at>clock_timestamp();

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

 RETURN v_identity||jsonb_build_object(
  'categories',v_categories,'products',v_products,
  'modifierGroups',v_groups,'modifierOptions',v_options
 );
END $$;
REVOKE ALL ON FUNCTION rcat_private.quick_guest_cart_review(bytea,uuid[],uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.quick_guest_cart_review(bytea,uuid[],uuid[]) TO rcat_auth;
