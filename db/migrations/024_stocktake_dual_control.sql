-- G3 controlled physical stocktake: two distinct staff identities, explicit
-- review, and version-based stale detection. This is not a Payment ledger.
ALTER TABLE rcat.inventory_items
  ADD COLUMN stock_version bigint NOT NULL DEFAULT 0
    CHECK(stock_version >= 0);

CREATE FUNCTION rcat_private.inventory_bump_stock_version()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog
AS $$
BEGIN
  IF NEW.on_hand IS DISTINCT FROM OLD.on_hand THEN
    NEW.stock_version := OLD.stock_version+1;
  ELSE
    NEW.stock_version := OLD.stock_version;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_stock_version_guard
BEFORE UPDATE ON rcat.inventory_items
FOR EACH ROW EXECUTE FUNCTION rcat_private.inventory_bump_stock_version();

CREATE TABLE rcat.inventory_stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  item_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  baseline_on_hand numeric(18,3) NOT NULL
    CHECK(baseline_on_hand BETWEEN 0 AND 1000000000000),
  baseline_version bigint NOT NULL CHECK(baseline_version>=0),
  counted_on_hand numeric(18,3)
    CHECK(counted_on_hand BETWEEN 0 AND 1000000000000),
  reason text CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 3 AND 200),
  state text NOT NULL DEFAULT 'open'
    CHECK(state IN ('open','submitted','approved','rejected')),
  created_by uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  submitted_by uuid REFERENCES rcat.users(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES rcat.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  UNIQUE(tenant_id,store_id,id),
  UNIQUE(tenant_id,store_id,idempotency_key),
  FOREIGN KEY(tenant_id,store_id,item_id)
    REFERENCES rcat.inventory_items(tenant_id,store_id,id) ON DELETE RESTRICT,
  CHECK (
    (state='open' AND counted_on_hand IS NULL AND reason IS NULL
       AND submitted_by IS NULL AND submitted_at IS NULL
       AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (state='submitted' AND counted_on_hand IS NOT NULL AND reason IS NOT NULL
       AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
       AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (state IN ('approved','rejected') AND counted_on_hand IS NOT NULL
       AND reason IS NOT NULL AND submitted_by IS NOT NULL
       AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
       AND reviewed_by<>submitted_by)
  )
);
CREATE UNIQUE INDEX inventory_one_pending_stocktake_per_item
  ON rcat.inventory_stocktakes(tenant_id,store_id,item_id)
  WHERE state IN ('open','submitted');
CREATE INDEX inventory_stocktakes_recent_idx
  ON rcat.inventory_stocktakes(tenant_id,store_id,created_at DESC,id DESC);

ALTER TABLE rcat.inventory_stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_stocktakes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.inventory_stocktakes FROM PUBLIC,rcat_auth,rcat_app;

ALTER TABLE rcat.inventory_movements
  DROP CONSTRAINT inventory_movements_kind_check;
ALTER TABLE rcat.inventory_movements
  ADD CONSTRAINT inventory_movements_kind_check CHECK (
    kind IN ('receipt','adjustment','order_consumption',
      'order_return','stocktake_adjustment')
  );
ALTER TABLE rcat.inventory_movements
  DROP CONSTRAINT inventory_movement_order_semantics;
ALTER TABLE rcat.inventory_movements
  ADD COLUMN stocktake_id uuid,
  ADD CONSTRAINT inventory_movement_stocktake_fk
    FOREIGN KEY(tenant_id,store_id,stocktake_id)
    REFERENCES rcat.inventory_stocktakes(tenant_id,store_id,id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_movement_order_semantics CHECK (
    (kind IN ('receipt','adjustment')
      AND order_id IS NULL AND stocktake_id IS NULL)
    OR (kind='order_consumption' AND order_id IS NOT NULL
      AND stocktake_id IS NULL AND delta<0)
    OR (kind='order_return' AND order_id IS NOT NULL
      AND stocktake_id IS NULL AND delta>0)
    OR (kind='stocktake_adjustment' AND order_id IS NULL
      AND stocktake_id IS NOT NULL)
  );
CREATE UNIQUE INDEX inventory_one_movement_per_stocktake
  ON rcat.inventory_movements(tenant_id,store_id,stocktake_id)
  WHERE stocktake_id IS NOT NULL;

-- Both owners and managers can open a physical count. A kitchen worker may
-- submit the count; the reviewer must be owner/manager and a different person.
CREATE FUNCTION rcat_private.inventory_open_stocktake(
 p_digest bytea,p_tenant uuid,p_store uuid,p_item uuid,p_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_item rcat.inventory_items%ROWTYPE;
  v_take rcat.inventory_stocktakes%ROWTYPE;
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,true);
  IF p_item IS NULL OR p_key IS NULL THEN
    RAISE EXCEPTION 'Invalid stocktake' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM rcat.inventory_items
   WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_item FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_take FROM rcat.inventory_stocktakes
   WHERE tenant_id=p_tenant AND store_id=p_store AND idempotency_key=p_key;
  IF FOUND THEN
    IF v_take.item_id<>p_item OR v_take.created_by<>v_actor THEN
      RAISE EXCEPTION 'Stocktake retry key changed'
        USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('stocktakeId',v_take.id,
      'itemId',v_take.item_id,'state',v_take.state,
      'baselineOnHand',v_take.baseline_on_hand::text,
      'baselineVersion',v_take.baseline_version::text,'replayed',true);
  END IF;
  INSERT INTO rcat.inventory_stocktakes(
    tenant_id,store_id,item_id,idempotency_key,
    baseline_on_hand,baseline_version,created_by
  ) VALUES(p_tenant,p_store,p_item,p_key,
    v_item.on_hand,v_item.stock_version,v_actor)
  RETURNING * INTO v_take;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata)
  VALUES(p_tenant,v_actor,'inventory.stocktake.opened',v_take.id,
    jsonb_build_object('storeId',p_store,'itemId',p_item,
      'baselineOnHand',v_item.on_hand::text,
      'baselineVersion',v_item.stock_version::text));
  RETURN jsonb_build_object('stocktakeId',v_take.id,
    'itemId',p_item,'state','open','baselineOnHand',v_item.on_hand::text,
    'baselineVersion',v_item.stock_version::text,'replayed',false);
END $$;

CREATE FUNCTION rcat_private.inventory_submit_stocktake(
 p_digest bytea,p_tenant uuid,p_store uuid,p_take uuid,
 p_counted numeric,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_take rcat.inventory_stocktakes%ROWTYPE;
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,false);
  IF p_take IS NULL OR p_counted IS NULL OR
     p_counted<0 OR p_counted>1000000000000 OR
     scale(p_counted)>3 OR p_reason IS NULL OR
     length(trim(p_reason)) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'Invalid stocktake count' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_take FROM rcat.inventory_stocktakes
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_take FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stocktake unavailable' USING ERRCODE='42501';
  END IF;
  IF v_take.state='submitted' AND
     v_take.submitted_by=v_actor AND
     v_take.counted_on_hand=p_counted AND v_take.reason=trim(p_reason) THEN
    RETURN jsonb_build_object('stocktakeId',p_take,
      'state','submitted','replayed',true);
  END IF;
  IF v_take.state<>'open' THEN
    RAISE EXCEPTION 'Stocktake already submitted or closed'
      USING ERRCODE='P0007';
  END IF;
  UPDATE rcat.inventory_stocktakes SET
    state='submitted',counted_on_hand=p_counted,
    reason=trim(p_reason),submitted_by=v_actor,
    submitted_at=clock_timestamp()
  WHERE id=p_take AND tenant_id=p_tenant AND store_id=p_store;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata)
  VALUES(p_tenant,v_actor,'inventory.stocktake.counted',p_take,
    jsonb_build_object('storeId',p_store,
      'countedOnHand',p_counted::text));
  RETURN jsonb_build_object('stocktakeId',p_take,
    'state','submitted','replayed',false);
END $$;

CREATE FUNCTION rcat_private.inventory_review_stocktake(
 p_digest bytea,p_tenant uuid,p_store uuid,p_take uuid,p_approve boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_take rcat.inventory_stocktakes%ROWTYPE;
  v_item rcat.inventory_items%ROWTYPE;v_delta numeric;v_movement uuid;
  v_state text;v_item_id uuid;
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,true);
  IF p_take IS NULL OR p_approve IS NULL THEN
    RAISE EXCEPTION 'Invalid stocktake review' USING ERRCODE='22023';
  END IF;
  v_state:=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  -- Use ingredient -> stocktake lock ordering, just like opening a count.
  -- Otherwise an opening count (ingredient -> unique pending row) racing an
  -- approval (stocktake -> ingredient) can deadlock in PostgreSQL.
  IF p_approve THEN
    SELECT item_id INTO v_item_id FROM rcat.inventory_stocktakes
      WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_take;
    IF FOUND THEN
      PERFORM 1 FROM rcat.inventory_items
        WHERE tenant_id=p_tenant AND store_id=p_store AND id=v_item_id
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Inventory unavailable' USING ERRCODE='42501';
      END IF;
    END IF;
  END IF;
  SELECT * INTO v_take FROM rcat.inventory_stocktakes
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_take FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stocktake unavailable' USING ERRCODE='42501';
  END IF;
  IF v_take.state=v_state AND v_take.reviewed_by=v_actor THEN
    RETURN jsonb_build_object('stocktakeId',p_take,'state',v_state,
      'movementId',(
        SELECT m.id FROM rcat.inventory_movements m
        WHERE m.tenant_id=p_tenant AND m.store_id=p_store
          AND m.stocktake_id=p_take
      ),'replayed',true);
  END IF;
  IF v_take.state<>'submitted' THEN
    RAISE EXCEPTION 'Stocktake not awaiting review' USING ERRCODE='P0007';
  END IF;
  IF v_take.submitted_by=v_actor THEN
    RAISE EXCEPTION 'Count requires a distinct reviewer'
      USING ERRCODE='P0007';
  END IF;
  IF p_approve THEN
    SELECT * INTO v_item FROM rcat.inventory_items
      WHERE tenant_id=p_tenant AND store_id=p_store
        AND id=v_take.item_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventory unavailable' USING ERRCODE='42501';
    END IF;
    IF v_item.stock_version<>v_take.baseline_version THEN
      RAISE EXCEPTION 'Inventory changed after count opened'
        USING ERRCODE='P0006';
    END IF;
    v_delta:=v_take.counted_on_hand-v_item.on_hand;
    IF abs(v_delta)>1000000000 THEN
      RAISE EXCEPTION 'Stocktake adjustment exceeds limit'
        USING ERRCODE='P0006';
    END IF;
    IF v_delta<>0 THEN
      UPDATE rcat.inventory_items SET
        on_hand=v_take.counted_on_hand,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND store_id=p_store AND id=v_take.item_id;
      INSERT INTO rcat.inventory_movements(
        tenant_id,store_id,item_id,idempotency_key,
        kind,delta,quantity_before,quantity_after,reason,
        actor_user_id,stocktake_id
      ) VALUES(p_tenant,p_store,v_take.item_id,p_take,
        'stocktake_adjustment',v_delta,v_item.on_hand,
        v_take.counted_on_hand,v_take.reason,v_actor,p_take)
      RETURNING id INTO v_movement;
    END IF;
  END IF;
  UPDATE rcat.inventory_stocktakes SET state=v_state,
    reviewed_by=v_actor,reviewed_at=clock_timestamp()
  WHERE id=p_take AND tenant_id=p_tenant AND store_id=p_store;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata
  ) VALUES(p_tenant,v_actor,'inventory.stocktake.'||v_state,p_take,
    jsonb_build_object('storeId',p_store,'itemId',v_take.item_id,
      'countedOnHand',v_take.counted_on_hand::text,
      'baselineOnHand',v_take.baseline_on_hand::text,
      'movementId',v_movement));
  RETURN jsonb_build_object('stocktakeId',p_take,'state',v_state,
    'movementId',v_movement,'replayed',false);
END $$;

CREATE FUNCTION rcat_private.inventory_stocktake_list(
 p_digest bytea,p_tenant uuid,p_store uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  PERFORM rcat_private._inventory_actor(p_digest,p_tenant,p_store,false);
  RETURN jsonb_build_object('stocktakes',COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'stocktakeId',v.id,'itemId',v.item_id,'state',v.state,
      'baselineOnHand',v.baseline_on_hand::text,
      'baselineVersion',v.baseline_version::text,
      'countedOnHand',v.counted_on_hand::text,
      'reason',v.reason,
      'createdAt',v.created_at,'submittedAt',v.submitted_at,
      'reviewedAt',v.reviewed_at,
      'createdBy',v.created_by,'submittedBy',v.submitted_by,
      'reviewedBy',v.reviewed_by)
      ORDER BY v.created_at DESC,v.id DESC)
    FROM (
      -- Always retain all unresolved counts in the review queue, even if
      -- more than 40 historical decisions have been recorded since opening.
      SELECT * FROM rcat.inventory_stocktakes
      WHERE tenant_id=p_tenant AND store_id=p_store
        AND state IN ('open','submitted')
      UNION ALL
      SELECT * FROM (
        SELECT * FROM rcat.inventory_stocktakes
        WHERE tenant_id=p_tenant AND store_id=p_store
          AND state IN ('approved','rejected')
        ORDER BY created_at DESC,id DESC LIMIT 40
      ) closed
    ) v
  ),'[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION rcat_private.inventory_bump_stock_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_open_stocktake(
 bytea,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_submit_stocktake(
 bytea,uuid,uuid,uuid,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_review_stocktake(
 bytea,uuid,uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_stocktake_list(
 bytea,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_open_stocktake(
 bytea,uuid,uuid,uuid,uuid) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_submit_stocktake(
 bytea,uuid,uuid,uuid,numeric,text) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_review_stocktake(
 bytea,uuid,uuid,uuid,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_stocktake_list(
 bytea,uuid,uuid) TO rcat_auth;
