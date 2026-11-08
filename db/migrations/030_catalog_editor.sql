-- G2 #38: audited compare-and-swap category / modifier editing.
-- Existing IDs and historical Order snapshots remain immutable.
CREATE FUNCTION rcat_private.edit_catalog_category(
 p_digest bytea,p_tenant uuid,p_store uuid,p_category uuid,
 p_expected_name text,p_expected_slug text,p_name text,p_slug text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_old rcat.menu_categories%ROWTYPE;v_changed boolean;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant,p_store,true);
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
   OR p_slug IS NULL OR length(p_slug) NOT BETWEEN 3 AND 48
   OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
   OR p_expected_name IS NULL OR p_expected_slug IS NULL THEN
   RAISE EXCEPTION 'Invalid category edit' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_old FROM rcat.menu_categories
 WHERE id=p_category AND tenant_id=p_tenant AND store_id=p_store FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Category unavailable' USING ERRCODE='42501'; END IF;
 IF v_old.name IS DISTINCT FROM p_expected_name
    OR v_old.slug IS DISTINCT FROM p_expected_slug THEN
   RAISE EXCEPTION 'Category changed' USING ERRCODE='P0009'; END IF;
 v_changed:=v_old.name IS DISTINCT FROM btrim(p_name)
   OR v_old.slug IS DISTINCT FROM p_slug;
 IF v_changed THEN
  UPDATE rcat.menu_categories SET name=btrim(p_name),slug=p_slug
  WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_category;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
  VALUES(p_tenant,v_actor,'catalog.category.updated',p_category,
   jsonb_build_object('storeId',p_store,'before',
      jsonb_build_object('name',v_old.name,'slug',v_old.slug),
      'after',jsonb_build_object('name',btrim(p_name),'slug',p_slug)));
 END IF;
 RETURN jsonb_build_object('categoryId',p_category,'changed',v_changed,
  'name',CASE WHEN v_changed THEN btrim(p_name) ELSE v_old.name END,
  'slug',CASE WHEN v_changed THEN p_slug ELSE v_old.slug END);
END $$;

CREATE FUNCTION rcat_private.edit_modifier_group(
 p_digest bytea,p_tenant uuid,p_store uuid,p_product uuid,p_group uuid,
 p_expected_name text,p_expected_slug text,p_expected_min integer,p_expected_max integer,
 p_name text,p_slug text,p_min integer,p_max integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_old rcat.menu_modifier_groups%ROWTYPE;
 v_product rcat.menu_products%ROWTYPE;v_changed boolean;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant,p_store,true);
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
   OR p_slug IS NULL OR length(p_slug) NOT BETWEEN 3 AND 48
   OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
   OR p_min IS NULL OR p_max IS NULL
   OR p_min NOT BETWEEN 0 AND 8 OR p_max NOT BETWEEN 1 AND 8
   OR p_min>p_max THEN
   RAISE EXCEPTION 'Invalid modifier group edit' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_product FROM rcat.menu_products
 WHERE id=p_product AND tenant_id=p_tenant AND store_id=p_store FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
 IF v_product.archived_at IS NOT NULL THEN
   RAISE EXCEPTION 'Product archived' USING ERRCODE='P0009'; END IF;
 SELECT * INTO v_old FROM rcat.menu_modifier_groups
 WHERE id=p_group AND product_id=p_product AND tenant_id=p_tenant
  AND store_id=p_store FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modifier group unavailable' USING ERRCODE='42501'; END IF;
 IF v_old.name IS DISTINCT FROM p_expected_name
   OR v_old.slug IS DISTINCT FROM p_expected_slug
   OR v_old.min_select IS DISTINCT FROM p_expected_min
   OR v_old.max_select IS DISTINCT FROM p_expected_max THEN
   RAISE EXCEPTION 'Modifier group changed' USING ERRCODE='P0009'; END IF;
 v_changed:=v_old.name IS DISTINCT FROM btrim(p_name)
   OR v_old.slug IS DISTINCT FROM p_slug
   OR v_old.min_select IS DISTINCT FROM p_min
   OR v_old.max_select IS DISTINCT FROM p_max;
 IF v_changed THEN
  UPDATE rcat.menu_modifier_groups
  SET name=btrim(p_name),slug=p_slug,min_select=p_min,max_select=p_max
  WHERE tenant_id=p_tenant AND store_id=p_store AND product_id=p_product
    AND id=p_group;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
  VALUES(p_tenant,v_actor,'catalog.modifier.group.updated',p_group,
    jsonb_build_object('storeId',p_store,'productId',p_product,
      'before',jsonb_build_object('name',v_old.name,'slug',v_old.slug,
        'minSelect',v_old.min_select,'maxSelect',v_old.max_select),
      'after',jsonb_build_object('name',btrim(p_name),'slug',p_slug,
        'minSelect',p_min,'maxSelect',p_max)));
 END IF;
 RETURN jsonb_build_object('groupId',p_group,'changed',v_changed);
END $$;

CREATE FUNCTION rcat_private.edit_modifier_option(
 p_digest bytea,p_tenant uuid,p_store uuid,p_product uuid,p_group uuid,p_option uuid,
 p_expected_name text,p_expected_delta bigint,p_expected_available boolean,
 p_name text,p_delta bigint,p_available boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_old rcat.menu_modifier_options%ROWTYPE;
 v_product rcat.menu_products%ROWTYPE;v_changed boolean;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant,p_store,true);
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
   OR p_delta IS NULL OR p_delta NOT BETWEEN -100000000 AND 100000000
   OR p_available IS NULL THEN
   RAISE EXCEPTION 'Invalid modifier option edit' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_product FROM rcat.menu_products
 WHERE id=p_product AND tenant_id=p_tenant AND store_id=p_store FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
 IF v_product.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Product archived' USING ERRCODE='P0009'; END IF;
 SELECT * INTO v_old FROM rcat.menu_modifier_options
 WHERE id=p_option AND group_id=p_group AND product_id=p_product
  AND tenant_id=p_tenant AND store_id=p_store FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modifier option unavailable' USING ERRCODE='42501'; END IF;
 IF v_old.name IS DISTINCT FROM p_expected_name
  OR v_old.price_delta_satang IS DISTINCT FROM p_expected_delta
  OR v_old.available IS DISTINCT FROM p_expected_available THEN
    RAISE EXCEPTION 'Modifier option changed' USING ERRCODE='P0009'; END IF;
 v_changed:=v_old.name IS DISTINCT FROM btrim(p_name)
   OR v_old.price_delta_satang IS DISTINCT FROM p_delta
   OR v_old.available IS DISTINCT FROM p_available;
 IF v_changed THEN
  UPDATE rcat.menu_modifier_options SET
   name=btrim(p_name),price_delta_satang=p_delta,available=p_available
  WHERE tenant_id=p_tenant AND store_id=p_store AND product_id=p_product
   AND group_id=p_group AND id=p_option;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
  VALUES(p_tenant,v_actor,'catalog.modifier.option.updated',p_option,
   jsonb_build_object('storeId',p_store,'productId',p_product,'groupId',p_group,
    'before',jsonb_build_object('name',v_old.name,'priceDeltaSatang',
      v_old.price_delta_satang,'available',v_old.available),
    'after',jsonb_build_object('name',btrim(p_name),'priceDeltaSatang',
      p_delta,'available',p_available)));
 END IF;
 RETURN jsonb_build_object('optionId',p_option,'changed',v_changed);
END $$;

REVOKE ALL ON FUNCTION rcat_private.edit_catalog_category(
 bytea,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.edit_modifier_group(
 bytea,uuid,uuid,uuid,uuid,text,text,integer,integer,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.edit_modifier_option(
 bytea,uuid,uuid,uuid,uuid,uuid,text,bigint,boolean,text,bigint,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.edit_catalog_category(
 bytea,uuid,uuid,uuid,text,text,text,text) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.edit_modifier_group(
 bytea,uuid,uuid,uuid,uuid,text,text,integer,integer,text,text,integer,integer) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.edit_modifier_option(
 bytea,uuid,uuid,uuid,uuid,uuid,text,bigint,boolean,text,bigint,boolean) TO rcat_auth;
