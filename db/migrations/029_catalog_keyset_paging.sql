-- G2 #38: real server-side bounded product pagination, never a full catalog download.
-- A staff-authorized, store-scoped keyset prevents offset drift at identical created_at.
CREATE INDEX menu_products_staff_page_idx ON rcat.menu_products
  (tenant_id, store_id, created_at, id);

CREATE FUNCTION rcat_private.catalog_products_page(
 p_digest bytea, p_tenant uuid, p_store uuid,
 p_search text, p_category uuid, p_include_archived boolean,
 p_after_created timestamptz, p_after_id uuid, p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
 v_products jsonb;
 v_categories jsonb;
 v_groups jsonb;
 v_options jsonb;
 v_has_more boolean;
 v_last_created timestamptz;
 v_last_id uuid;
BEGIN
 PERFORM rcat_private._catalog_actor(p_digest,p_tenant,p_store,false);
 IF p_search IS NULL OR length(btrim(p_search))>80
    OR p_include_archived IS NULL OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 50
    OR (p_after_created IS NULL)<>(p_after_id IS NULL)
 THEN RAISE EXCEPTION 'Invalid catalog page parameters' USING ERRCODE='22023'; END IF;

 WITH matched AS MATERIALIZED (
  SELECT p.* FROM rcat.menu_products p
  WHERE p.tenant_id=p_tenant AND p.store_id=p_store
    AND (p_include_archived OR p.archived_at IS NULL)
    AND (p_category IS NULL OR p.category_id=p_category)
    AND (btrim(p_search)='' OR
         strpos(lower(p.name),lower(btrim(p_search)))>0)
    AND (p_after_id IS NULL OR
         (p.created_at,p.id)>(p_after_created,p_after_id))
  ORDER BY p.created_at,p.id LIMIT p_limit+1
 ), visible AS MATERIALIZED (
  SELECT * FROM matched ORDER BY created_at,id LIMIT p_limit
 )
 SELECT COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.name,'categoryId',p.category_id,
     'priceSatang',p.price_satang,'available',p.available,
     'revision',p.revision,'archivedAt',p.archived_at,
     'hasImage',EXISTS(
       SELECT 1 FROM rcat.menu_product_media m
       WHERE m.tenant_id=p.tenant_id AND m.store_id=p.store_id
         AND m.product_id=p.id
     )
   ) ORDER BY p.created_at,p.id) FROM visible p
 ),'[]'::jsonb),
 (SELECT count(*)>p_limit FROM matched),
 (SELECT p.created_at FROM visible p
   ORDER BY p.created_at DESC,p.id DESC LIMIT 1),
 (SELECT p.id FROM visible p
   ORDER BY p.created_at DESC,p.id DESC LIMIT 1)
 INTO v_products,v_has_more,v_last_created,v_last_id;

 SELECT COALESCE(jsonb_agg(
   jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug)
   ORDER BY c.sort_order,c.slug
 ),'[]'::jsonb) INTO v_categories
 FROM rcat.menu_categories c
 WHERE c.tenant_id=p_tenant AND c.store_id=p_store;

 SELECT COALESCE(jsonb_agg(
   jsonb_build_object('id',g.id,'productId',g.product_id,
      'slug',g.slug,'name',g.name,'minSelect',g.min_select,
      'maxSelect',g.max_select)
   ORDER BY g.sort_order,g.slug
 ),'[]'::jsonb) INTO v_groups
 FROM rcat.menu_modifier_groups g
 WHERE g.tenant_id=p_tenant AND g.store_id=p_store
   AND EXISTS (SELECT 1 FROM rcat.menu_products p
     WHERE p.id=g.product_id AND p.tenant_id=p_tenant
       AND p.store_id=p_store AND p.id IN (
         SELECT (item->>'id')::uuid FROM jsonb_array_elements(v_products) item
       ));

 SELECT COALESCE(jsonb_agg(
   jsonb_build_object('id',o.id,'productId',o.product_id,
     'groupId',o.group_id,'name',o.name,
     'priceDeltaSatang',o.price_delta_satang,'available',o.available)
   ORDER BY o.sort_order,o.name
 ),'[]'::jsonb) INTO v_options
 FROM rcat.menu_modifier_options o
 WHERE o.tenant_id=p_tenant AND o.store_id=p_store
   AND o.product_id IN (
     SELECT (item->>'id')::uuid FROM jsonb_array_elements(v_products) item
   );

 RETURN jsonb_build_object(
   'categories',v_categories,'products',v_products,
   'modifierGroups',v_groups,'modifierOptions',v_options,
   'hasMore',v_has_more,
   'nextCursor',CASE WHEN v_has_more THEN
     jsonb_build_object('createdAt',v_last_created,'id',v_last_id)
     ELSE NULL END
 );
END $$;

REVOKE ALL ON FUNCTION rcat_private.catalog_products_page(
 bytea,uuid,uuid,text,uuid,boolean,timestamptz,uuid,integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.catalog_products_page(
 bytea,uuid,uuid,text,uuid,boolean,timestamptz,uuid,integer
) TO rcat_auth;
