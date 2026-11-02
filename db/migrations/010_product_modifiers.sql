-- G2 add-ons: store-scoped modifier groups and options.
-- Prices are integer satang; order snapshot/quote validation belongs to #6.
CREATE TABLE rcat.menu_modifier_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 store_id uuid NOT NULL,
 product_id uuid NOT NULL,
 slug text NOT NULL CHECK(length(slug) BETWEEN 3 AND 48
   AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 min_select integer NOT NULL DEFAULT 0 CHECK(min_select BETWEEN 0 AND 8),
 max_select integer NOT NULL DEFAULT 1 CHECK(max_select BETWEEN 1 AND 8),
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(min_select<=max_select),
 UNIQUE(tenant_id,store_id,product_id,id),
 UNIQUE(tenant_id,store_id,product_id,slug),
 FOREIGN KEY(tenant_id,store_id,product_id)
   REFERENCES rcat.menu_products(tenant_id,store_id,id) ON DELETE RESTRICT
);
CREATE TABLE rcat.menu_modifier_options (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 store_id uuid NOT NULL,
 product_id uuid NOT NULL,
 group_id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 price_delta_satang bigint NOT NULL
   CHECK(price_delta_satang BETWEEN -100000000 AND 100000000),
 available boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,store_id,product_id,group_id,id),
 UNIQUE(tenant_id,store_id,product_id,group_id,name),
 FOREIGN KEY(tenant_id,store_id,product_id,group_id)
   REFERENCES rcat.menu_modifier_groups(tenant_id,store_id,product_id,id)
   ON DELETE RESTRICT
);
CREATE INDEX modifier_groups_product_idx ON rcat.menu_modifier_groups
 (tenant_id,store_id,product_id,sort_order);
CREATE INDEX modifier_options_group_idx ON rcat.menu_modifier_options
 (tenant_id,store_id,group_id,sort_order);

ALTER TABLE rcat.menu_modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.menu_modifier_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.menu_modifier_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.menu_modifier_options FORCE ROW LEVEL SECURITY;
CREATE POLICY modifier_groups_read ON rcat.menu_modifier_groups
 FOR SELECT TO rcat_app
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY modifier_options_read ON rcat.menu_modifier_options
 FOR SELECT TO rcat_app
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT ON rcat.menu_modifier_groups,rcat.menu_modifier_options TO rcat_app;

CREATE FUNCTION rcat_private.add_modifier_group(
 p_digest bytea,p_tenant_id uuid,p_store_id uuid,p_product_id uuid,
 p_slug text,p_name text,p_min integer,p_max integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_id uuid;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant_id,p_store_id,true);
 IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR length(p_slug) NOT BETWEEN 3 AND 48
    OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120
    OR p_min IS NULL OR p_max IS NULL OR p_min NOT BETWEEN 0 AND 8
    OR p_max NOT BETWEEN 1 AND 8 OR p_min>p_max
 THEN RAISE EXCEPTION 'Invalid modifier group' USING ERRCODE='22023'; END IF;
 -- Bound growth and serialize mutations on the parent product row.
 PERFORM 1 FROM rcat.menu_products p WHERE p.id=p_product_id
  AND p.tenant_id=p_tenant_id AND p.store_id=p_store_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM rcat.menu_modifier_groups g
  WHERE g.tenant_id=p_tenant_id AND g.store_id=p_store_id
   AND g.product_id=p_product_id)>=10
 THEN RAISE EXCEPTION 'Too many modifier groups' USING ERRCODE='22023'; END IF;
 INSERT INTO rcat.menu_modifier_groups(
   tenant_id,store_id,product_id,slug,name,min_select,max_select
 ) VALUES(p_tenant_id,p_store_id,p_product_id,p_slug,trim(p_name),p_min,p_max)
 RETURNING id INTO v_id;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id)
 VALUES(p_tenant_id,v_actor,'catalog.modifier.group.created',v_id);
 RETURN v_id;
END $$;

CREATE FUNCTION rcat_private.add_modifier_option(
 p_digest bytea,p_tenant_id uuid,p_store_id uuid,p_product_id uuid,
 p_group_id uuid,p_name text,p_delta bigint
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_id uuid;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant_id,p_store_id,true);
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120
    OR p_delta IS NULL OR p_delta NOT BETWEEN -100000000 AND 100000000
 THEN RAISE EXCEPTION 'Invalid modifier option' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM rcat.menu_modifier_groups g
 WHERE g.id=p_group_id AND g.tenant_id=p_tenant_id
 AND g.store_id=p_store_id AND g.product_id=p_product_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group unavailable' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM rcat.menu_modifier_options o
   WHERE o.tenant_id=p_tenant_id AND o.store_id=p_store_id
    AND o.product_id=p_product_id AND o.group_id=p_group_id)>=30
 THEN RAISE EXCEPTION 'Too many modifier options' USING ERRCODE='22023'; END IF;
 INSERT INTO rcat.menu_modifier_options(
   tenant_id,store_id,product_id,group_id,name,price_delta_satang
 ) VALUES(p_tenant_id,p_store_id,p_product_id,p_group_id,trim(p_name),p_delta)
 RETURNING id INTO v_id;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
 VALUES(p_tenant_id,v_actor,'catalog.modifier.option.created',v_id,
  jsonb_build_object('price_delta_satang',p_delta));
 RETURN v_id;
END $$;

CREATE FUNCTION rcat_private.set_modifier_option_availability(
 p_digest bytea,p_tenant_id uuid,p_store_id uuid,p_product_id uuid,
 p_group_id uuid,p_option_id uuid,p_available boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_prior boolean;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant_id,p_store_id,true);
 IF p_available IS NULL THEN
  RAISE EXCEPTION 'Invalid availability' USING ERRCODE='22023'; END IF;
 SELECT available INTO v_prior FROM rcat.menu_modifier_options
 WHERE tenant_id=p_tenant_id AND store_id=p_store_id
   AND product_id=p_product_id AND group_id=p_group_id AND id=p_option_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Option unavailable' USING ERRCODE='42501'; END IF;
 IF v_prior IS DISTINCT FROM p_available THEN
  UPDATE rcat.menu_modifier_options SET available=p_available
  WHERE tenant_id=p_tenant_id AND store_id=p_store_id
    AND product_id=p_product_id AND group_id=p_group_id AND id=p_option_id;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,
    metadata)
  VALUES(p_tenant_id,v_actor,'catalog.modifier.option.availability',
    p_option_id,jsonb_build_object('previous',v_prior,'next',p_available));
 END IF;
 RETURN p_available;
END $$;

REVOKE ALL ON FUNCTION rcat_private.add_modifier_group(bytea,uuid,uuid,uuid,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.add_modifier_option(bytea,uuid,uuid,uuid,uuid,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.set_modifier_option_availability(bytea,uuid,uuid,uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.add_modifier_group(bytea,uuid,uuid,uuid,text,text,integer,integer) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.add_modifier_option(bytea,uuid,uuid,uuid,uuid,text,bigint) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.set_modifier_option_availability(bytea,uuid,uuid,uuid,uuid,uuid,boolean) TO rcat_auth;

-- Preserve the original scoped authorization and append modifier metadata.
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
      'name',p.name,'priceSatang',p.price_satang,'available',p.available)
      ORDER BY p.created_at,p.id)
    FROM rcat.menu_products p WHERE p.tenant_id=p_tenant_id
      AND p.store_id=p_store_id
  ),'[]'::jsonb)
 );
END $$;


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
 WHERE visit.token_digest=p_token_digest AND visit.revoked_at IS NULL
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

