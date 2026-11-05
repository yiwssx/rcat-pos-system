-- G2 #38: bounded, single-image WebP media per product.
-- Keep safe binary bytes inside the existing PostgreSQL backup/recovery scope;
-- do not accept SVG/HTML, external URLs or arbitrary file paths.
CREATE TABLE rcat.menu_product_media (
 tenant_id uuid NOT NULL,
 store_id uuid NOT NULL,
 product_id uuid NOT NULL,
 webp bytea NOT NULL CHECK(octet_length(webp) BETWEEN 30 AND 196608),
 digest_sha256 bytea NOT NULL CHECK(octet_length(digest_sha256)=32),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 1600),
 height integer NOT NULL CHECK(height BETWEEN 1 AND 1600),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,store_id,product_id),
 FOREIGN KEY(tenant_id,store_id,product_id)
 REFERENCES rcat.menu_products(tenant_id,store_id,id) ON DELETE RESTRICT
);
ALTER TABLE rcat.menu_product_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.menu_product_media FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.menu_product_media FROM PUBLIC,rcat_app,rcat_auth;

CREATE FUNCTION rcat_private.put_menu_product_media(
 p_session bytea,p_tenant uuid,p_store uuid,p_product uuid,
 p_revision bigint,p_webp bytea,p_sha bytea,p_width integer,p_height integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_product rcat.menu_products%ROWTYPE;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
 IF p_product IS NULL OR p_revision IS NULL OR p_revision<0
   OR p_webp IS NULL OR octet_length(p_webp) NOT BETWEEN 30 AND 196608
   OR p_sha IS NULL OR octet_length(p_sha)<>32
   OR p_width NOT BETWEEN 1 AND 1600 OR p_height NOT BETWEEN 1 AND 1600 THEN
    RAISE EXCEPTION 'Invalid product image' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_product FROM rcat.menu_products
 WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
 IF v_product.archived_at IS NOT NULL OR v_product.revision<>p_revision THEN
   RAISE EXCEPTION 'Product changed or archived' USING ERRCODE='P0009'; END IF;
 INSERT INTO rcat.menu_product_media(
   tenant_id,store_id,product_id,webp,digest_sha256,width,height
 ) VALUES(p_tenant,p_store,p_product,p_webp,p_sha,p_width,p_height)
 ON CONFLICT(tenant_id,store_id,product_id)
 DO UPDATE SET webp=EXCLUDED.webp,digest_sha256=EXCLUDED.digest_sha256,
  width=EXCLUDED.width,height=EXCLUDED.height,updated_at=clock_timestamp();
 UPDATE rcat.menu_products SET revision=revision+1,updated_at=clock_timestamp()
 WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
 VALUES(p_tenant,v_actor,'catalog.product.image.updated',p_product,
   jsonb_build_object('storeId',p_store,'width',p_width,'height',p_height,
     'sizeBytes',octet_length(p_webp),'revision',p_revision+1));
 RETURN jsonb_build_object('productId',p_product,'revision',p_revision+1,
     'hasImage',true);
END $$;

CREATE FUNCTION rcat_private.remove_menu_product_media(
 p_session bytea,p_tenant uuid,p_store uuid,p_product uuid,p_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_product rcat.menu_products%ROWTYPE;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
 IF p_product IS NULL OR p_revision IS NULL OR p_revision<0 THEN
    RAISE EXCEPTION 'Invalid product image request' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_product FROM rcat.menu_products
 WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
 IF v_product.archived_at IS NOT NULL OR v_product.revision<>p_revision THEN
    RAISE EXCEPTION 'Product changed or archived' USING ERRCODE='P0009'; END IF;
 DELETE FROM rcat.menu_product_media WHERE tenant_id=p_tenant
   AND store_id=p_store AND product_id=p_product;
 IF NOT FOUND THEN
    RAISE EXCEPTION 'Product image unavailable' USING ERRCODE='42501'; END IF;
 UPDATE rcat.menu_products SET revision=revision+1,updated_at=clock_timestamp()
 WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
 VALUES(p_tenant,v_actor,'catalog.product.image.removed',p_product,
   jsonb_build_object('storeId',p_store,'revision',p_revision+1));
 RETURN jsonb_build_object('productId',p_product,'revision',p_revision+1,
   'hasImage',false);
END $$;

CREATE FUNCTION rcat_private.read_public_menu_media(
 p_tenant uuid,p_store uuid,p_product uuid
) RETURNS TABLE(webp bytea,digest_sha256 bytea)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $$
 SELECT m.webp,m.digest_sha256 FROM rcat.menu_product_media m
 JOIN rcat.menu_products p
 ON p.tenant_id=m.tenant_id AND p.store_id=m.store_id
   AND p.id=m.product_id
 WHERE m.tenant_id=p_tenant AND m.store_id=p_store
   AND m.product_id=p_product AND p.available AND p.archived_at IS NULL
$$;

CREATE FUNCTION rcat_private.read_staff_menu_media(
 p_session bytea,p_tenant uuid,p_store uuid,p_product uuid
) RETURNS TABLE(webp bytea,digest_sha256 bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
 PERFORM rcat_private._catalog_actor(p_session,p_tenant,p_store,false);
 RETURN QUERY SELECT m.webp,m.digest_sha256
 FROM rcat.menu_product_media m
 WHERE m.tenant_id=p_tenant AND m.store_id=p_store AND m.product_id=p_product;
END $$;

REVOKE ALL ON FUNCTION rcat_private.put_menu_product_media(
 bytea,uuid,uuid,uuid,bigint,bytea,bytea,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.remove_menu_product_media(
 bytea,uuid,uuid,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.read_public_menu_media(
 uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.read_staff_menu_media(
 bytea,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.put_menu_product_media(
 bytea,uuid,uuid,uuid,bigint,bytea,bytea,integer,integer) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.remove_menu_product_media(
 bytea,uuid,uuid,uuid,bigint) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.read_public_menu_media(
 uuid,uuid,uuid) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.read_staff_menu_media(
 bytea,uuid,uuid,uuid) TO rcat_auth;

-- Preserve modifiers and CAS metadata in both serialized catalog views.
CREATE OR REPLACE FUNCTION rcat_private.catalog_snapshot(
 p_digest bytea,p_tenant_id uuid,p_store_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
 PERFORM rcat_private._catalog_actor(p_digest,p_tenant_id,p_store_id,false);
 RETURN jsonb_build_object(
  'categories',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',c.id,'slug',c.slug,'name',c.name)
      ORDER BY c.sort_order,c.slug)
    FROM rcat.menu_categories c WHERE c.tenant_id=p_tenant_id
      AND c.store_id=p_store_id
  ),'[]'::jsonb),
  'modifierGroups',COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'id',g.id,'productId',g.product_id,'slug',g.slug,
     'name',g.name,'minSelect',g.min_select,'maxSelect',g.max_select)
     ORDER BY g.sort_order,g.slug)
   FROM rcat.menu_modifier_groups g
   JOIN rcat.menu_products mp ON mp.id=g.product_id
     AND mp.tenant_id=g.tenant_id AND mp.store_id=g.store_id
   WHERE g.tenant_id=p_tenant_id AND g.store_id=p_store_id
 ),'[]'::jsonb),
 'modifierOptions',COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'id',o.id,'productId',o.product_id,'groupId',o.group_id,
     'name',o.name,'priceDeltaSatang',o.price_delta_satang,
     'available',o.available) ORDER BY o.sort_order,o.name)
   FROM rcat.menu_modifier_options o
   WHERE o.tenant_id=p_tenant_id AND o.store_id=p_store_id
 ),'[]'::jsonb),
 'products',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',p.id,'categoryId',p.category_id,
      'name',p.name,'priceSatang',p.price_satang,
      'available',p.available,'revision',p.revision,
      'archivedAt',p.archived_at,
      'hasImage',EXISTS(SELECT 1 FROM rcat.menu_product_media m
         WHERE m.tenant_id=p.tenant_id AND m.store_id=p.store_id
          AND m.product_id=p.id))
      ORDER BY p.created_at,p.id)
    FROM rcat.menu_products p WHERE p.tenant_id=p_tenant_id
      AND p.store_id=p_store_id
  ),'[]'::jsonb)
 );
END $$;
