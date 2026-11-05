-- G2 follow-up #38: safe mutable merchant catalog, soft archive and CAS edits.
-- Orders retain immutable name/price/option snapshots; never DELETE products.
ALTER TABLE rcat.menu_products
  ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT menu_product_archived_not_saleable
    CHECK (archived_at IS NULL OR available=false);
CREATE INDEX menu_products_active_store_idx
  ON rcat.menu_products(tenant_id,store_id,category_id,created_at,id)
  WHERE archived_at IS NULL;

-- Optimistic locking refuses stale Merchant tabs instead of silently
-- overwriting another manager's price/category edits.
CREATE FUNCTION rcat_private.update_menu_product(
 p_digest bytea,p_tenant uuid,p_store uuid,p_product uuid,
 p_revision bigint,p_name text,p_category uuid,p_price_satang bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_old rcat.menu_products%ROWTYPE;v_changed boolean;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant,p_store,true);
 IF p_product IS NULL OR p_category IS NULL OR p_revision IS NULL
    OR p_revision<0 OR p_name IS NULL
    OR length(trim(p_name)) NOT BETWEEN 1 AND 160
    OR p_price_satang IS NULL OR p_price_satang NOT BETWEEN 1 AND 100000000
 THEN RAISE EXCEPTION 'Invalid product update' USING ERRCODE='22023'; END IF;

 SELECT * INTO v_old FROM rcat.menu_products
 WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
 IF v_old.archived_at IS NOT NULL THEN
   RAISE EXCEPTION 'Product was archived' USING ERRCODE='P0009'; END IF;
 IF v_old.revision<>p_revision THEN
   RAISE EXCEPTION 'Product changed; refresh before editing'
     USING ERRCODE='P0009'; END IF;
 PERFORM 1 FROM rcat.menu_categories
 WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_category;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Category unavailable' USING ERRCODE='42501'; END IF;

 v_changed:=v_old.name IS DISTINCT FROM trim(p_name)
    OR v_old.category_id IS DISTINCT FROM p_category
    OR v_old.price_satang IS DISTINCT FROM p_price_satang;
 IF v_changed THEN
   UPDATE rcat.menu_products
   SET name=trim(p_name),category_id=p_category,
       price_satang=p_price_satang,revision=revision+1,
       updated_at=clock_timestamp()
   WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product;
   INSERT INTO rcat.audit_events(
     tenant_id,actor_user_id,action,subject_id,metadata)
   VALUES(p_tenant,v_actor,'catalog.product.updated',p_product,
     jsonb_build_object('storeId',p_store,
       'before',jsonb_build_object('revision',v_old.revision,
         'name',v_old.name,'categoryId',v_old.category_id,
         'priceSatang',v_old.price_satang),
       'after',jsonb_build_object('revision',v_old.revision+1,
         'name',trim(p_name),'categoryId',p_category,
         'priceSatang',p_price_satang)));
 END IF;
 RETURN jsonb_build_object(
   'productId',p_product,'name',CASE WHEN v_changed THEN trim(p_name)
     ELSE v_old.name END,
   'categoryId',CASE WHEN v_changed THEN p_category ELSE v_old.category_id END,
   'priceSatang',CASE WHEN v_changed THEN p_price_satang
     ELSE v_old.price_satang END,
   'revision',CASE WHEN v_changed THEN v_old.revision+1 ELSE v_old.revision END,
   'changed',v_changed);
END $$;

-- Soft archive keeps order, inventory, recipe and audit foreign keys intact.
-- After archive a new item can be created with a new immutable UUID.
CREATE FUNCTION rcat_private.archive_menu_product(
 p_digest bytea,p_tenant uuid,p_store uuid,p_product uuid,p_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_old rcat.menu_products%ROWTYPE;v_when timestamptz;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant,p_store,true);
 IF p_product IS NULL OR p_revision IS NULL OR p_revision<0 THEN
   RAISE EXCEPTION 'Invalid product archive' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_old FROM rcat.menu_products
 WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
 IF v_old.archived_at IS NOT NULL OR v_old.revision<>p_revision THEN
   RAISE EXCEPTION 'Product changed; refresh before archiving'
     USING ERRCODE='P0009'; END IF;
 v_when:=clock_timestamp();
 UPDATE rcat.menu_products SET available=false,archived_at=v_when,
    revision=revision+1,updated_at=v_when
 WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product;
 INSERT INTO rcat.audit_events(
   tenant_id,actor_user_id,action,subject_id,metadata)
 VALUES(p_tenant,v_actor,'catalog.product.archived',p_product,
   jsonb_build_object('storeId',p_store,'revision',v_old.revision+1,
     'previousAvailable',v_old.available));
 RETURN jsonb_build_object('productId',p_product,'archived',true,
    'available',false,'revision',v_old.revision+1);
END $$;

-- Prevent archived goods from becoming sellable through the preexisting API.
CREATE OR REPLACE FUNCTION rcat_private.set_menu_product_availability(
 p_digest bytea,p_tenant_id uuid,p_store_id uuid,
 p_product_id uuid,p_available boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_prior boolean;v_archived timestamptz;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant_id,p_store_id,true);
 IF p_available IS NULL THEN
   RAISE EXCEPTION 'Invalid availability' USING ERRCODE='22023'; END IF;
 SELECT available,archived_at INTO v_prior,v_archived
 FROM rcat.menu_products WHERE tenant_id=p_tenant_id
  AND store_id=p_store_id AND id=p_product_id FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
 IF v_archived IS NOT NULL THEN
   RAISE EXCEPTION 'Archived product cannot be reactivated'
     USING ERRCODE='P0009'; END IF;
 IF v_prior IS DISTINCT FROM p_available THEN
   UPDATE rcat.menu_products SET available=p_available,
     revision=revision+1,updated_at=clock_timestamp()
   WHERE tenant_id=p_tenant_id AND store_id=p_store_id AND id=p_product_id;
   INSERT INTO rcat.audit_events(
     tenant_id,actor_user_id,action,subject_id,metadata)
   VALUES(p_tenant_id,v_actor,'catalog.product.availability',p_product_id,
     jsonb_build_object('previous',v_prior,'next',p_available));
 END IF;
 RETURN p_available;
END $$;

-- Preserve modifier data while exposing server-authoritative CAS revision.
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
      'archivedAt',p.archived_at)
      ORDER BY p.created_at,p.id)
    FROM rcat.menu_products p WHERE p.tenant_id=p_tenant_id
      AND p.store_id=p_store_id
  ),'[]'::jsonb)
 );
END $$;

REVOKE ALL ON FUNCTION rcat_private.update_menu_product(
 bytea,uuid,uuid,uuid,bigint,text,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.archive_menu_product(
 bytea,uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.update_menu_product(
 bytea,uuid,uuid,uuid,bigint,text,uuid,bigint) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.archive_menu_product(
 bytea,uuid,uuid,uuid,bigint) TO rcat_auth;
