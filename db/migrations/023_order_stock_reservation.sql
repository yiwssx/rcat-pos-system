-- G3 stock acceptance/release. Explicit product tracking is OFF by default:
-- existing menus/orders continue unchanged until a manager opts in per product.
-- Payments, Order money, and table QR are entirely unaffected.

CREATE TABLE rcat.inventory_tracked_products (
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  enabled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,store_id,product_id),
  FOREIGN KEY(tenant_id,store_id,product_id)
    REFERENCES rcat.menu_products(tenant_id,store_id,id) ON DELETE RESTRICT
);

CREATE TABLE rcat.inventory_modifier_recipe_components (
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  group_id uuid NOT NULL,
  option_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity_per_product numeric(18,3) NOT NULL
    CHECK(quantity_per_product>0 AND quantity_per_product<=1000000000),
  PRIMARY KEY(tenant_id,store_id,option_id,item_id),
  FOREIGN KEY(tenant_id,store_id,product_id,group_id,option_id)
    REFERENCES rcat.menu_modifier_options(tenant_id,store_id,product_id,group_id,id)
    ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,store_id,item_id)
    REFERENCES rcat.inventory_items(tenant_id,store_id,id) ON DELETE RESTRICT
);
CREATE INDEX inventory_modifier_recipe_product_idx
  ON rcat.inventory_modifier_recipe_components(tenant_id,store_id,product_id);

CREATE TABLE rcat.inventory_order_allocations (
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity numeric(18,3) NOT NULL
    CHECK(quantity>0 AND quantity<=1000000000),
  allocated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  returned_at timestamptz,
  PRIMARY KEY(tenant_id,store_id,order_id,item_id),
  FOREIGN KEY(tenant_id,store_id,order_id)
    REFERENCES rcat.orders(tenant_id,store_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,store_id,item_id)
    REFERENCES rcat.inventory_items(tenant_id,store_id,id) ON DELETE RESTRICT,
  CHECK(returned_at IS NULL OR returned_at>=allocated_at)
);
CREATE INDEX inventory_allocations_unreturned_idx
  ON rcat.inventory_order_allocations(tenant_id,store_id,order_id)
  WHERE returned_at IS NULL;

-- Preserve the original manual inventory history; append explicitly typed
-- automatic movements and an Order FK. Manual movement API remains unchanged.
ALTER TABLE rcat.inventory_movements
  DROP CONSTRAINT inventory_movements_kind_check;
ALTER TABLE rcat.inventory_movements
  ADD CONSTRAINT inventory_movements_kind_check CHECK
    (kind IN ('receipt','adjustment','order_consumption','order_return'));
ALTER TABLE rcat.inventory_movements
  ADD COLUMN order_id uuid,
  ADD CONSTRAINT inventory_movement_order_fk
    FOREIGN KEY(tenant_id,store_id,order_id)
    REFERENCES rcat.orders(tenant_id,store_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_movement_order_semantics CHECK (
    (kind IN ('receipt','adjustment') AND order_id IS NULL)
    OR (kind='order_consumption' AND order_id IS NOT NULL AND delta<0)
    OR (kind='order_return' AND order_id IS NOT NULL AND delta>0)
  );

ALTER TABLE rcat.inventory_tracked_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_tracked_products FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_modifier_recipe_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_modifier_recipe_components FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_order_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_order_allocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.inventory_tracked_products,
  rcat.inventory_modifier_recipe_components,rcat.inventory_order_allocations
  FROM PUBLIC,rcat_app,rcat_auth;

-- Synchronizes with any in-flight acceptance via a product row lock.
-- Require a base recipe for every product whose stock is automatically tracked.
CREATE FUNCTION rcat_private.inventory_set_product_tracking(
  p_digest bytea,p_tenant uuid,p_store uuid,p_product uuid,p_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_was boolean;
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,true);
  IF p_product IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Invalid stock tracking' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM rcat.menu_products
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable' USING ERRCODE='42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM rcat.inventory_tracked_products
    WHERE tenant_id=p_tenant AND store_id=p_store AND product_id=p_product)
    INTO v_was;
  IF p_enabled AND NOT EXISTS(
    SELECT 1 FROM rcat.inventory_recipe_components
    WHERE tenant_id=p_tenant AND store_id=p_store AND product_id=p_product
  ) THEN
    RAISE EXCEPTION 'Base recipe required for stock tracking'
      USING ERRCODE='P0005';
  END IF;
  IF p_enabled THEN
    INSERT INTO rcat.inventory_tracked_products(tenant_id,store_id,product_id)
    VALUES(p_tenant,p_store,p_product) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM rcat.inventory_tracked_products
     WHERE tenant_id=p_tenant AND store_id=p_store AND product_id=p_product;
  END IF;
  IF v_was IS DISTINCT FROM p_enabled THEN
    INSERT INTO rcat.audit_events(
      tenant_id,actor_user_id,action,subject_id,metadata)
    VALUES(p_tenant,v_actor,'inventory.product.tracking',p_product,
      jsonb_build_object('storeId',p_store,'enabled',p_enabled));
  END IF;
  RETURN jsonb_build_object('productId',p_product,'tracked',p_enabled);
END $$;

-- A selected modifier can add ingredient consumption to the base recipe.
-- No component for an option means explicitly zero EXTRA stock consumption;
-- managers must review all modifiers before enabling tracked products.
CREATE FUNCTION rcat_private.inventory_set_modifier_recipe(
  p_digest bytea,p_tenant uuid,p_store uuid,p_product uuid,p_group uuid,
  p_option uuid,p_item uuid,p_quantity numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,true);
  IF p_product IS NULL OR p_group IS NULL OR p_option IS NULL OR
     p_item IS NULL OR p_quantity IS NULL OR p_quantity<0 OR
     p_quantity>1000000000 OR scale(p_quantity)>3
  THEN RAISE EXCEPTION 'Invalid modifier recipe' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM rcat.menu_products
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(
    SELECT 1 FROM rcat.menu_modifier_options
    WHERE tenant_id=p_tenant AND store_id=p_store AND
      product_id=p_product AND group_id=p_group AND id=p_option)
    OR NOT EXISTS(
    SELECT 1 FROM rcat.inventory_items
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_item)
  THEN RAISE EXCEPTION 'Modifier ingredient unavailable' USING ERRCODE='42501'; END IF;
  IF p_quantity=0 THEN
    DELETE FROM rcat.inventory_modifier_recipe_components
    WHERE tenant_id=p_tenant AND store_id=p_store AND option_id=p_option
      AND item_id=p_item;
  ELSE
    INSERT INTO rcat.inventory_modifier_recipe_components(
      tenant_id,store_id,product_id,group_id,option_id,item_id,
      quantity_per_product)
    VALUES(p_tenant,p_store,p_product,p_group,p_option,p_item,p_quantity)
    ON CONFLICT(tenant_id,store_id,option_id,item_id)
    DO UPDATE SET quantity_per_product=EXCLUDED.quantity_per_product;
  END IF;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
    VALUES(p_tenant,v_actor,'inventory.modifier.recipe',p_option,
      jsonb_build_object('storeId',p_store,'productId',p_product,
        'itemId',p_item,'quantityPerProduct',p_quantity::text));
  RETURN jsonb_build_object('optionId',p_option,'itemId',p_item,
    'quantityPerProduct',p_quantity::text);
END $$;

-- Base recipe edits also lock the product in the same order as acceptance;
-- otherwise an accepting Order could see a partially edited recipe.
CREATE OR REPLACE FUNCTION rcat_private.inventory_set_recipe(
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
  THEN RAISE EXCEPTION 'Invalid recipe quantity' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM rcat.menu_products
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_product FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(
    SELECT 1 FROM rcat.inventory_items
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

-- Keep the legacy read contract and only ADD opt-in/option recipe details.
-- The renamed helper still verifies the caller and returns no raw SQL access.
ALTER FUNCTION rcat_private.inventory_snapshot(bytea,uuid,uuid)
  RENAME TO inventory_manual_snapshot;
CREATE FUNCTION rcat_private.inventory_snapshot(
  p_digest bytea,p_tenant uuid,p_store uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_snapshot jsonb;v_enabled boolean;
BEGIN
  v_snapshot:=rcat_private.inventory_manual_snapshot(p_digest,p_tenant,p_store);
  SELECT EXISTS(SELECT 1 FROM rcat.inventory_tracked_products
    WHERE tenant_id=p_tenant AND store_id=p_store) INTO v_enabled;
  RETURN v_snapshot || jsonb_build_object(
    'stockMode',CASE WHEN v_enabled THEN
      'order_acceptance_opt_in' ELSE 'manual_ledger_only' END,
    'orderConsumptionEnabled',v_enabled,
    'trackedProducts',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'productId',t.product_id,'productName',p.name)
        ORDER BY p.name,t.product_id)
      FROM rcat.inventory_tracked_products t JOIN rcat.menu_products p
        ON p.tenant_id=t.tenant_id AND p.store_id=t.store_id
        AND p.id=t.product_id
      WHERE t.tenant_id=p_tenant AND t.store_id=p_store
    ),'[]'::jsonb),
    'modifierRecipes',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'optionId',m.option_id,'productId',m.product_id,
        'itemId',m.item_id,'quantityPerProduct',m.quantity_per_product::text)
        ORDER BY m.product_id,m.option_id,m.item_id)
      FROM rcat.inventory_modifier_recipe_components m
      WHERE m.tenant_id=p_tenant AND m.store_id=p_store
    ),'[]'::jsonb)
  );
END $$;

-- Called ONLY from the CAS status transition after locking the Order row.
-- Lock every product in UUID order (recipe/track edits lock product FOR UPDATE)
-- then every ingredient in UUID order (stock changes lock ingredient FOR UPDATE).
-- All updates, ledger rows, allocations and Order status commit or roll back.
CREATE FUNCTION rcat_private._allocate_order_stock(
  p_tenant uuid,p_store uuid,p_order uuid,p_actor uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_product record;v_need record;v_count integer:=0;v_qty numeric;
BEGIN
  -- No automatic effect for products not explicitly opted into tracking.
  FOR v_product IN
    SELECT p.id FROM rcat.menu_products p
    WHERE p.tenant_id=p_tenant AND p.store_id=p_store
      AND p.id IN (
        SELECT DISTINCT i.product_id FROM rcat.order_items i
        JOIN rcat.inventory_tracked_products t
          ON t.tenant_id=i.tenant_id AND t.store_id=i.store_id
          AND t.product_id=i.product_id
        WHERE i.tenant_id=p_tenant AND i.store_id=p_store
          AND i.order_id=p_order
      )
    ORDER BY p.id FOR SHARE
  LOOP
    IF NOT EXISTS(
      SELECT 1 FROM rcat.inventory_recipe_components
      WHERE tenant_id=p_tenant AND store_id=p_store
        AND product_id=v_product.id
    ) THEN
      RAISE EXCEPTION 'Tracked product lacks ingredient recipe'
        USING ERRCODE='P0005';
    END IF;
  END LOOP;

  FOR v_need IN
    SELECT stock.id AS item_id,stock.on_hand,requirements.needed
    FROM (
      SELECT parts.item_id,sum(parts.qty)::numeric AS needed
      FROM (
        SELECT recipe.item_id,
          recipe.quantity_per_product*line.quantity AS qty
        FROM rcat.order_items line
        JOIN rcat.inventory_tracked_products t
          ON t.tenant_id=line.tenant_id AND t.store_id=line.store_id
          AND t.product_id=line.product_id
        JOIN rcat.inventory_recipe_components recipe
          ON recipe.tenant_id=line.tenant_id AND recipe.store_id=line.store_id
          AND recipe.product_id=line.product_id
        WHERE line.tenant_id=p_tenant AND line.store_id=p_store
          AND line.order_id=p_order
        UNION ALL
        SELECT recipe.item_id,
          recipe.quantity_per_product*line.quantity AS qty
        FROM rcat.order_items line
        JOIN rcat.inventory_tracked_products t
          ON t.tenant_id=line.tenant_id AND t.store_id=line.store_id
          AND t.product_id=line.product_id
        CROSS JOIN LATERAL jsonb_array_elements(line.option_snapshots) opt
        JOIN rcat.inventory_modifier_recipe_components recipe
          ON recipe.tenant_id=line.tenant_id AND recipe.store_id=line.store_id
          AND recipe.product_id=line.product_id
          AND recipe.option_id::text=opt->>'optionId'
        WHERE line.tenant_id=p_tenant AND line.store_id=p_store
          AND line.order_id=p_order
      ) parts
      GROUP BY parts.item_id
    ) requirements
    JOIN rcat.inventory_items stock
      ON stock.tenant_id=p_tenant AND stock.store_id=p_store
      AND stock.id=requirements.item_id
    ORDER BY stock.id FOR UPDATE OF stock
  LOOP
    v_qty:=v_need.needed;
    IF v_qty<=0 OR v_qty>1000000000 OR scale(v_qty)>3
      OR v_need.on_hand<v_qty THEN
      RAISE EXCEPTION 'Insufficient or unrepresentable stock'
        USING ERRCODE='P0004';
    END IF;
    INSERT INTO rcat.inventory_order_allocations(
      tenant_id,store_id,order_id,item_id,quantity
    ) VALUES(p_tenant,p_store,p_order,v_need.item_id,v_qty);
    UPDATE rcat.inventory_items
      SET on_hand=on_hand-v_qty,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND store_id=p_store AND id=v_need.item_id;
    INSERT INTO rcat.inventory_movements(
      tenant_id,store_id,item_id,idempotency_key,kind,delta,
      quantity_before,quantity_after,reason,actor_user_id,order_id)
    VALUES(p_tenant,p_store,v_need.item_id,gen_random_uuid(),
      'order_consumption',-v_qty,v_need.on_hand,v_need.on_hand-v_qty,
      'Order accepted: '||p_order::text,p_actor,p_order);
    v_count:=v_count+1;
  END LOOP;
  IF v_count>0 THEN
    INSERT INTO rcat.audit_events(
      tenant_id,actor_user_id,action,subject_id,metadata)
    VALUES(p_tenant,p_actor,'inventory.order.allocated',p_order,
      jsonb_build_object('storeId',p_store,'ingredients',v_count));
  END IF;
  RETURN v_count;
END $$;

-- Uses persisted Order allocation quantities, NEVER mutable recipes.
-- Row locks are acquired in the same ingredient UUID order as allocation.
CREATE FUNCTION rcat_private._return_order_stock(
  p_tenant uuid,p_store uuid,p_order uuid,p_actor uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_record record;v_count integer:=0;
BEGIN
  FOR v_record IN
    SELECT a.item_id,a.quantity,stock.on_hand
    FROM rcat.inventory_order_allocations a
    JOIN rcat.inventory_items stock ON
      stock.tenant_id=a.tenant_id AND stock.store_id=a.store_id
      AND stock.id=a.item_id
    WHERE a.tenant_id=p_tenant AND a.store_id=p_store
      AND a.order_id=p_order AND a.returned_at IS NULL
    ORDER BY stock.id FOR UPDATE OF stock
  LOOP
    IF v_record.on_hand+v_record.quantity>1000000000000 THEN
      RAISE EXCEPTION 'Restored inventory exceeds limit'
        USING ERRCODE='P0004';
    END IF;
    UPDATE rcat.inventory_items SET
      on_hand=on_hand+v_record.quantity,updated_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=v_record.item_id;
    UPDATE rcat.inventory_order_allocations
      SET returned_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND store_id=p_store AND order_id=p_order
      AND item_id=v_record.item_id AND returned_at IS NULL;
    INSERT INTO rcat.inventory_movements(
      tenant_id,store_id,item_id,idempotency_key,kind,delta,
      quantity_before,quantity_after,reason,actor_user_id,order_id)
    VALUES(p_tenant,p_store,v_record.item_id,gen_random_uuid(),
      'order_return',v_record.quantity,v_record.on_hand,
      v_record.on_hand+v_record.quantity,
      'Order cancelled: '||p_order::text,p_actor,p_order);
    v_count:=v_count+1;
  END LOOP;
  IF v_count>0 THEN
    INSERT INTO rcat.audit_events(
      tenant_id,actor_user_id,action,subject_id,metadata)
    VALUES(p_tenant,p_actor,'inventory.order.returned',p_order,
      jsonb_build_object('storeId',p_store,'ingredients',v_count));
  END IF;
  RETURN v_count;
END $$;

-- Reuses all original role-transition rules, CAS semantics and existing
-- Order status audit/outbox trigger; only adds atomic stock side effects.
CREATE OR REPLACE FUNCTION rcat_private.transition_merchant_order(
  p_digest bytea, p_tenant_id uuid, p_store_id uuid, p_order_id uuid,
  p_expected text, p_next text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;v_order rcat.orders%ROWTYPE;
  v_stock_count integer:=0;
BEGIN
  SELECT actor_id,staff_role INTO v_actor,v_role
  FROM rcat_private._order_staff_actor(p_digest,p_tenant_id,p_store_id);
  IF p_order_id IS NULL OR p_expected IS NULL OR p_next IS NULL THEN
    RAISE EXCEPTION 'Invalid Order transition' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_order FROM rcat.orders
  WHERE id=p_order_id AND tenant_id=p_tenant_id AND store_id=p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;
  IF v_order.status<>p_expected THEN
    RAISE EXCEPTION 'Order status changed' USING ERRCODE='P0001';
  END IF;
  IF NOT (
    (p_expected='submitted' AND p_next IN ('accepted','cancelled')
      AND v_role IN ('owner','manager','cashier'))
    OR (p_expected='accepted' AND p_next='preparing'
      AND v_role IN ('owner','manager','kitchen'))
    OR (p_expected='accepted' AND p_next='cancelled'
      AND v_role IN ('owner','manager','cashier'))
    OR (p_expected='preparing' AND p_next='served'
      AND v_role IN ('owner','manager','kitchen'))
  ) THEN RAISE EXCEPTION 'Order transition not permitted' USING ERRCODE='42501'; END IF;

  IF p_expected='submitted' AND p_next='accepted' THEN
    v_stock_count:=rcat_private._allocate_order_stock(
      p_tenant_id,p_store_id,p_order_id,v_actor);
  ELSIF p_expected='accepted' AND p_next='cancelled' THEN
    v_stock_count:=rcat_private._return_order_stock(
      p_tenant_id,p_store_id,p_order_id,v_actor);
  END IF;

  UPDATE rcat.orders SET status=p_next,updated_at=clock_timestamp()
    WHERE id=v_order.id;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata)
  VALUES(p_tenant_id,v_actor,'order.status.changed',v_order.id,
    jsonb_build_object('storeId',p_store_id,'from',p_expected,'to',p_next));
  RETURN jsonb_build_object(
    'orderId',v_order.id,'status',p_next,
    'amountSatang',v_order.amount_satang,'currency',v_order.currency,
    'paymentState',v_order.payment_state,
    'inventoryMovementCount',v_stock_count);
END $$;

REVOKE ALL ON FUNCTION rcat_private.inventory_set_product_tracking(
  bytea,uuid,uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_set_modifier_recipe(
  bytea,uuid,uuid,uuid,uuid,uuid,uuid,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_snapshot(bytea,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private._allocate_order_stock(uuid,uuid,uuid,uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private._return_order_stock(uuid,uuid,uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_set_product_tracking(
  bytea,uuid,uuid,uuid,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_set_modifier_recipe(
  bytea,uuid,uuid,uuid,uuid,uuid,uuid,numeric) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_snapshot(bytea,uuid,uuid)
  TO rcat_auth;
