-- G2: tenant- and store-scoped catalog baseline. Payment is NOT part of this migration.
-- SKU/catalog values are mutable; submitted Order snapshots will be immutable under #6.
CREATE TABLE rcat.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  slug text NOT NULL CHECK (
    length(slug) BETWEEN 3 AND 48 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,store_id,id),
  UNIQUE(tenant_id,store_id,slug),
  FOREIGN KEY (tenant_id,store_id) REFERENCES rcat.stores(tenant_id,id)
    ON DELETE RESTRICT
);
CREATE INDEX menu_categories_store_idx
  ON rcat.menu_categories(tenant_id,store_id,sort_order);

CREATE TABLE rcat.menu_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  category_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  price_satang bigint NOT NULL CHECK(price_satang BETWEEN 1 AND 100000000),
  available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id,category_id)
    REFERENCES rcat.menu_categories(tenant_id,store_id,id) ON DELETE RESTRICT
);
CREATE INDEX menu_products_store_category_idx
  ON rcat.menu_products(tenant_id,store_id,category_id,available);

-- Application sessions can only READ their verified tenant; all catalog writes
-- flow through SECURITY DEFINER functions using a hashed authenticated session.
ALTER TABLE rcat.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.menu_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.menu_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.menu_products FORCE ROW LEVEL SECURITY;
CREATE POLICY menu_categories_tenant_read ON rcat.menu_categories
  FOR SELECT TO rcat_app
  USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY menu_products_tenant_read ON rcat.menu_products
  FOR SELECT TO rcat_app
  USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT ON rcat.menu_categories,rcat.menu_products TO rcat_app;

CREATE FUNCTION rcat_private._catalog_actor(
  p_digest bytea,p_tenant_id uuid,p_store_id uuid,p_write boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_digest);
  SELECT m.role INTO v_role
    FROM rcat.tenant_memberships m
    WHERE m.tenant_id=p_tenant_id AND m.user_id=v_actor FOR SHARE;
  IF v_role IS NULL OR
     (p_write AND v_role NOT IN ('owner','manager')) OR
     (NOT p_write AND v_role NOT IN ('owner','manager','cashier')) OR
     NOT EXISTS (SELECT 1 FROM rcat.stores s
       WHERE s.id=p_store_id AND s.tenant_id=p_tenant_id)
  THEN
    RAISE EXCEPTION 'Catalog unavailable' USING ERRCODE='42501';
  END IF;
  RETURN v_actor;
END $$;

CREATE FUNCTION rcat_private.add_menu_category(
 p_digest bytea,p_tenant_id uuid,p_store_id uuid,
 p_slug text,p_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_id uuid;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant_id,p_store_id,true);
 INSERT INTO rcat.menu_categories(tenant_id,store_id,slug,name)
 VALUES(p_tenant_id,p_store_id,p_slug,trim(p_name)) RETURNING id INTO v_id;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id)
 VALUES(p_tenant_id,v_actor,'catalog.category.created',v_id);
 RETURN v_id;
END $$;

CREATE FUNCTION rcat_private.add_menu_product(
 p_digest bytea,p_tenant_id uuid,p_store_id uuid,
 p_category_id uuid,p_name text,p_price_satang bigint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_id uuid;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant_id,p_store_id,true);
 INSERT INTO rcat.menu_products(
   tenant_id,store_id,category_id,name,price_satang
 ) VALUES(p_tenant_id,p_store_id,p_category_id,trim(p_name),p_price_satang)
 RETURNING id INTO v_id;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,
    metadata)
 VALUES(p_tenant_id,v_actor,'catalog.product.created',v_id,
   jsonb_build_object('price_satang',p_price_satang));
 RETURN v_id;
END $$;

CREATE FUNCTION rcat_private.set_menu_product_availability(
 p_digest bytea,p_tenant_id uuid,p_store_id uuid,
 p_product_id uuid,p_available boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_prior boolean;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant_id,p_store_id,true);
 IF p_available IS NULL THEN RAISE EXCEPTION 'Invalid availability' USING ERRCODE='22023'; END IF;
 SELECT available INTO v_prior FROM rcat.menu_products
  WHERE tenant_id=p_tenant_id AND store_id=p_store_id AND id=p_product_id
  FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
 IF v_prior IS DISTINCT FROM p_available THEN
  UPDATE rcat.menu_products SET available=p_available,updated_at=now()
  WHERE tenant_id=p_tenant_id AND store_id=p_store_id AND id=p_product_id;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,
    metadata)
  VALUES(p_tenant_id,v_actor,'catalog.product.availability',p_product_id,
    jsonb_build_object('previous',v_prior,'next',p_available));
 END IF;
 RETURN p_available;
END $$;

CREATE FUNCTION rcat_private.catalog_snapshot(
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
  'products',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',p.id,'categoryId',p.category_id,
      'name',p.name,'priceSatang',p.price_satang,'available',p.available)
      ORDER BY p.created_at,p.id)
    FROM rcat.menu_products p WHERE p.tenant_id=p_tenant_id
      AND p.store_id=p_store_id
  ),'[]'::jsonb)
 );
END $$;

REVOKE ALL ON FUNCTION rcat_private._catalog_actor(bytea,uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.add_menu_category(bytea,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.add_menu_product(bytea,uuid,uuid,uuid,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.set_menu_product_availability(bytea,uuid,uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.catalog_snapshot(bytea,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.add_menu_category(bytea,uuid,uuid,text,text) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.add_menu_product(bytea,uuid,uuid,uuid,text,bigint) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.set_menu_product_availability(bytea,uuid,uuid,uuid,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.catalog_snapshot(bytea,uuid,uuid) TO rcat_auth;
