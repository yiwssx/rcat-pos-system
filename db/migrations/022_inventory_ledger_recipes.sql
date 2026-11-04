-- G3 inventory foundation: scoped, exact quantities and immutable movement ledger.
-- A recipe is planning metadata; NOT an automatic Order reservation/deduction.
-- No Payment / PromptPay, cost accounting, or bank ledger semantics.

CREATE TABLE rcat.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  unit text NOT NULL CHECK(unit IN ('g','ml','unit')),
  on_hand numeric(18,3) NOT NULL DEFAULT 0
    CHECK(on_hand BETWEEN 0 AND 1000000000000),
  reorder_at numeric(18,3) NOT NULL DEFAULT 0
    CHECK(reorder_at BETWEEN 0 AND 1000000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,store_id,id),
  UNIQUE(tenant_id,store_id,name),
  FOREIGN KEY(tenant_id,store_id) REFERENCES rcat.stores(tenant_id,id)
    ON DELETE RESTRICT
);
CREATE INDEX inventory_items_store_idx
  ON rcat.inventory_items(tenant_id,store_id,name);

CREATE TABLE rcat.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  item_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('receipt','adjustment')),
  delta numeric(18,3) NOT NULL CHECK(delta<>0 AND abs(delta)<=1000000000),
  quantity_before numeric(18,3) NOT NULL CHECK(quantity_before>=0),
  quantity_after numeric(18,3) NOT NULL CHECK(quantity_after>=0),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 200),
  actor_user_id uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,store_id,idempotency_key),
  FOREIGN KEY(tenant_id,store_id,item_id)
    REFERENCES rcat.inventory_items(tenant_id,store_id,id) ON DELETE RESTRICT,
  CHECK(quantity_after=quantity_before+delta),
  CHECK(kind<>'receipt' OR delta>0)
);
CREATE INDEX inventory_movements_store_time_idx
  ON rcat.inventory_movements(tenant_id,store_id,created_at DESC,id DESC);

CREATE TABLE rcat.inventory_recipe_components (
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity_per_product numeric(18,3) NOT NULL
    CHECK(quantity_per_product>0 AND quantity_per_product<=1000000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,store_id,product_id,item_id),
  FOREIGN KEY(tenant_id,store_id,product_id)
    REFERENCES rcat.menu_products(tenant_id,store_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,store_id,item_id)
    REFERENCES rcat.inventory_items(tenant_id,store_id,id) ON DELETE RESTRICT
);
CREATE INDEX inventory_recipes_by_item_idx
  ON rcat.inventory_recipe_components(tenant_id,store_id,item_id);

-- None of these tables is directly exposed to rcat_auth / rcat_app;
-- all access is authorized in reviewed SECURITY DEFINER routines.
ALTER TABLE rcat.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_items FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_recipe_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_recipe_components FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.inventory_items,rcat.inventory_movements,
  rcat.inventory_recipe_components FROM PUBLIC,rcat_auth,rcat_app;

CREATE FUNCTION rcat_private._inventory_actor(
  p_digest bytea,p_tenant uuid,p_store uuid,p_write boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;
BEGIN
  SELECT actor_id,staff_role INTO v_actor,v_role
  FROM rcat_private._order_staff_actor(p_digest,p_tenant,p_store);
  IF v_role NOT IN ('owner','manager','kitchen')
     OR (p_write AND v_role NOT IN ('owner','manager'))
  THEN
    RAISE EXCEPTION 'Inventory unavailable' USING ERRCODE='42501';
  END IF;
  RETURN v_actor;
END $$;

CREATE FUNCTION rcat_private.inventory_snapshot(
  p_digest bytea,p_tenant uuid,p_store uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  PERFORM rcat_private._inventory_actor(p_digest,p_tenant,p_store,false);
  RETURN jsonb_build_object(
    'items',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'itemId',i.id,'name',i.name,'unit',i.unit,
        'onHand',i.on_hand::text,'reorderAt',i.reorder_at::text)
        ORDER BY i.name,i.id)
      FROM rcat.inventory_items i
      WHERE i.tenant_id=p_tenant AND i.store_id=p_store
    ),'[]'::jsonb),
    'recipes',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productId',r.product_id,'productName',p.name,
        'itemId',r.item_id,'quantityPerProduct',r.quantity_per_product::text)
        ORDER BY p.name,r.product_id,r.item_id)
      FROM rcat.inventory_recipe_components r
      JOIN rcat.menu_products p
        ON p.tenant_id=r.tenant_id AND p.store_id=r.store_id
        AND p.id=r.product_id
      WHERE r.tenant_id=p_tenant AND r.store_id=p_store
    ),'[]'::jsonb),
    'recentMovements',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'movementId',m.id,'itemId',m.item_id,'kind',m.kind,
        'delta',m.delta::text,'quantityAfter',m.quantity_after::text,
        'reason',m.reason,'createdAt',m.created_at)
        ORDER BY m.created_at DESC,m.id DESC)
      FROM (
        SELECT * FROM rcat.inventory_movements
        WHERE tenant_id=p_tenant AND store_id=p_store
        ORDER BY created_at DESC,id DESC LIMIT 50
      ) m
    ),'[]'::jsonb),
    'stockMode','manual_ledger_only',
    'orderConsumptionEnabled',false
  );
END $$;

CREATE FUNCTION rcat_private.inventory_create_item(
  p_digest bytea,p_tenant uuid,p_store uuid,
  p_name text,p_unit text,p_reorder_at numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_id uuid;
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,true);
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120
     OR p_unit IS NULL OR p_unit NOT IN ('g','ml','unit')
     OR p_reorder_at IS NULL OR p_reorder_at<0
     OR p_reorder_at>1000000000000
     OR scale(p_reorder_at)>3
  THEN RAISE EXCEPTION 'Invalid inventory item' USING ERRCODE='22023';
  END IF;
  INSERT INTO rcat.inventory_items(tenant_id,store_id,name,unit,reorder_at)
    VALUES(p_tenant,p_store,trim(p_name),p_unit,p_reorder_at)
    RETURNING id INTO v_id;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,
    metadata)
    VALUES(p_tenant,v_actor,'inventory.item.created',v_id,
      jsonb_build_object('storeId',p_store,'unit',p_unit));
  RETURN v_id;
END $$;

CREATE FUNCTION rcat_private.inventory_move(
  p_digest bytea,p_tenant uuid,p_store uuid,p_item uuid,
  p_key uuid,p_kind text,p_delta numeric,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_item rcat.inventory_items%ROWTYPE;
        v_previous rcat.inventory_movements%ROWTYPE;
        v_id uuid;v_next numeric(18,3);
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,true);
  IF p_item IS NULL OR p_key IS NULL
     OR p_kind NOT IN ('receipt','adjustment') OR p_kind IS NULL
     OR p_delta IS NULL OR p_delta=0 OR abs(p_delta)>1000000000
     OR scale(p_delta)>3
     OR (p_kind='receipt' AND p_delta<=0)
     OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 200
  THEN RAISE EXCEPTION 'Invalid stock movement' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM rcat.inventory_items
   WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_item FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory unavailable' USING ERRCODE='42501';
  END IF;

  -- Serializes same-item mutations and ambiguous HTTP retries. Replaying a
  -- key with different semantics cannot silently affect stock.
  SELECT * INTO v_previous FROM rcat.inventory_movements
    WHERE tenant_id=p_tenant AND store_id=p_store AND idempotency_key=p_key;
  IF FOUND THEN
    IF v_previous.item_id IS DISTINCT FROM p_item OR
       v_previous.kind IS DISTINCT FROM p_kind OR
       v_previous.delta IS DISTINCT FROM p_delta OR
       v_previous.reason IS DISTINCT FROM trim(p_reason)
    THEN RAISE EXCEPTION 'Inventory key reused' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('movementId',v_previous.id,
      'itemId',v_previous.item_id,'onHand',v_previous.quantity_after::text,
      'replayed',true);
  END IF;

  IF v_item.on_hand+p_delta<0 OR
     v_item.on_hand+p_delta>1000000000000
  THEN RAISE EXCEPTION 'Insufficient stock or quantity overflow'
       USING ERRCODE='22023'; END IF;
  v_next:=v_item.on_hand+p_delta;
  UPDATE rcat.inventory_items
    SET on_hand=v_next,updated_at=clock_timestamp()
    WHERE id=p_item AND tenant_id=p_tenant AND store_id=p_store;
  INSERT INTO rcat.inventory_movements(
    tenant_id,store_id,item_id,idempotency_key,kind,delta,
    quantity_before,quantity_after,reason,actor_user_id
  ) VALUES (
    p_tenant,p_store,p_item,p_key,p_kind,p_delta,
    v_item.on_hand,v_next,trim(p_reason),v_actor
  ) RETURNING id INTO v_id;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,
    metadata)
    VALUES(p_tenant,v_actor,'inventory.movement.created',v_id,
      jsonb_build_object('storeId',p_store,'itemId',p_item,
        'kind',p_kind,'delta',p_delta::text));
  RETURN jsonb_build_object('movementId',v_id,'itemId',p_item,
    'onHand',v_next::text,'replayed',false);
END $$;

CREATE FUNCTION rcat_private.inventory_set_recipe(
  p_digest bytea,p_tenant uuid,p_store uuid,p_product uuid,
  p_item uuid,p_quantity numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,true);
  IF p_product IS NULL OR p_item IS NULL OR p_quantity IS NULL
     OR p_quantity<0 OR p_quantity>1000000000
     OR scale(p_quantity)>3
  THEN RAISE EXCEPTION 'Invalid recipe quantity' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rcat.menu_products
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product)
    OR NOT EXISTS (SELECT 1 FROM rcat.inventory_items
      WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_item)
  THEN RAISE EXCEPTION 'Recipe unavailable' USING ERRCODE='42501'; END IF;

  IF p_quantity=0 THEN
    DELETE FROM rcat.inventory_recipe_components
      WHERE tenant_id=p_tenant AND store_id=p_store
      AND product_id=p_product AND item_id=p_item;
  ELSE
    INSERT INTO rcat.inventory_recipe_components(
      tenant_id,store_id,product_id,item_id,quantity_per_product
    ) VALUES(p_tenant,p_store,p_product,p_item,p_quantity)
    ON CONFLICT(tenant_id,store_id,product_id,item_id)
    DO UPDATE SET quantity_per_product=EXCLUDED.quantity_per_product,
      updated_at=now();
  END IF;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,
    metadata)
    VALUES(p_tenant,v_actor,'inventory.recipe.changed',p_product,
      jsonb_build_object('storeId',p_store,'itemId',p_item,
        'quantityPerProduct',p_quantity::text));
  RETURN jsonb_build_object('productId',p_product,'itemId',p_item,
    'quantityPerProduct',p_quantity::text);
END $$;

REVOKE ALL ON FUNCTION rcat_private._inventory_actor(bytea,uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_snapshot(bytea,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_create_item(
  bytea,uuid,uuid,text,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_move(
  bytea,uuid,uuid,uuid,uuid,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_set_recipe(
  bytea,uuid,uuid,uuid,uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_snapshot(bytea,uuid,uuid)
  TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_create_item(
  bytea,uuid,uuid,text,text,numeric) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_move(
  bytea,uuid,uuid,uuid,uuid,text,numeric,text) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_set_recipe(
  bytea,uuid,uuid,uuid,uuid,numeric) TO rcat_auth;
