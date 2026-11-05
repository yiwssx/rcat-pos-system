-- G3: exceptional return of unused, recoverable ingredients AFTER kitchen work starts.
-- This is a physical inventory correction, not an Order cancellation, refund,
-- payment settlement, or automatic return of consumed/spoiled ingredients.
-- An owner/manager requests; a different owner/manager approves or rejects.
-- Lock order row before the request row; lock ingredient last on approval.
CREATE TABLE rcat.inventory_exception_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  item_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  quantity numeric(18,3) NOT NULL
    CHECK(quantity > 0 AND quantity <= 1000000000),
  category text NOT NULL CHECK(category IN
    ('unused_unopened','kitchen_error_unconsumed')),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 200),
  state text NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','approved','rejected')),
  created_by uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES rcat.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  UNIQUE(tenant_id,store_id,id),
  UNIQUE(tenant_id,store_id,idempotency_key),
  FOREIGN KEY(tenant_id,store_id,order_id,item_id)
    REFERENCES rcat.inventory_order_allocations(tenant_id,store_id,order_id,item_id)
    ON DELETE RESTRICT,
  CHECK (
    (state='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (state IN ('approved','rejected') AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL AND reviewed_by<>created_by)
  )
);
CREATE UNIQUE INDEX inventory_exception_one_pending_per_allocation
  ON rcat.inventory_exception_returns(tenant_id,store_id,order_id,item_id)
  WHERE state='pending';
CREATE INDEX inventory_exception_order_history
  ON rcat.inventory_exception_returns(tenant_id,store_id,order_id,created_at DESC,id DESC);
ALTER TABLE rcat.inventory_exception_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.inventory_exception_returns FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.inventory_exception_returns FROM PUBLIC,rcat_app,rcat_auth;

ALTER TABLE rcat.inventory_movements
  DROP CONSTRAINT inventory_movements_kind_check;
ALTER TABLE rcat.inventory_movements
  ADD CONSTRAINT inventory_movements_kind_check CHECK(kind IN
    ('receipt','adjustment','order_consumption','order_return',
     'stocktake_adjustment','exception_return'));
ALTER TABLE rcat.inventory_movements
  DROP CONSTRAINT inventory_movement_order_semantics;
ALTER TABLE rcat.inventory_movements
  ADD COLUMN exception_return_id uuid,
  ADD CONSTRAINT inventory_movement_exception_fk
    FOREIGN KEY(tenant_id,store_id,exception_return_id)
    REFERENCES rcat.inventory_exception_returns(tenant_id,store_id,id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_movement_order_semantics CHECK (
    (kind IN ('receipt','adjustment') AND order_id IS NULL
      AND stocktake_id IS NULL AND exception_return_id IS NULL)
    OR (kind='order_consumption' AND order_id IS NOT NULL
      AND stocktake_id IS NULL AND exception_return_id IS NULL AND delta<0)
    OR (kind='order_return' AND order_id IS NOT NULL
      AND stocktake_id IS NULL AND exception_return_id IS NULL AND delta>0)
    OR (kind='stocktake_adjustment' AND order_id IS NULL
      AND stocktake_id IS NOT NULL AND exception_return_id IS NULL)
    OR (kind='exception_return' AND order_id IS NOT NULL
      AND stocktake_id IS NULL AND exception_return_id IS NOT NULL AND delta>0)
  );
CREATE UNIQUE INDEX inventory_exception_single_movement
  ON rcat.inventory_movements(tenant_id,store_id,exception_return_id)
  WHERE exception_return_id IS NOT NULL;

CREATE FUNCTION rcat_private.inventory_exception_return_view(
  p_digest bytea,p_tenant uuid,p_store uuid,p_order uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_status text;
BEGIN
  PERFORM rcat_private._inventory_actor(p_digest,p_tenant,p_store,false);
  IF p_order IS NULL THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;
  SELECT status INTO v_status FROM rcat.orders
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'orderId',p_order,'orderStatus',v_status,
    'eligible',v_status IN ('preparing','served'),
    'allocations',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'itemId',a.item_id,'itemName',i.name,'unit',i.unit,
        'allocated',a.quantity::text,
        'alreadyReturned',COALESCE(used.total,0)::text,
        'remaining',CASE WHEN a.returned_at IS NULL
          THEN (a.quantity-COALESCE(used.total,0))::text ELSE '0' END)
        ORDER BY i.name,a.item_id)
      FROM rcat.inventory_order_allocations a
      JOIN rcat.inventory_items i
        ON i.tenant_id=a.tenant_id AND i.store_id=a.store_id
        AND i.id=a.item_id
      LEFT JOIN LATERAL (
        SELECT sum(e.quantity) AS total FROM rcat.inventory_exception_returns e
        WHERE e.tenant_id=a.tenant_id AND e.store_id=a.store_id
          AND e.order_id=a.order_id AND e.item_id=a.item_id
          AND e.state='approved'
      ) used ON true
      WHERE a.tenant_id=p_tenant AND a.store_id=p_store AND a.order_id=p_order
    ),'[]'::jsonb),
    'requests',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'requestId',e.id,'itemId',e.item_id,'quantity',e.quantity::text,
        'category',e.category,'reason',e.reason,'state',e.state,
        'createdBy',e.created_by,'reviewedBy',e.reviewed_by,
        'createdAt',e.created_at,'reviewedAt',e.reviewed_at)
        ORDER BY (e.state='pending') DESC,e.created_at DESC,e.id DESC)
      FROM (
        SELECT * FROM rcat.inventory_exception_returns
        WHERE tenant_id=p_tenant AND store_id=p_store AND order_id=p_order
        ORDER BY (state='pending') DESC,created_at DESC,id DESC LIMIT 50
      ) e
    ),'[]'::jsonb)
  );
END $$;

CREATE FUNCTION rcat_private.inventory_request_exception_return(
  p_digest bytea,p_tenant uuid,p_store uuid,p_order uuid,p_item uuid,
  p_key uuid,p_quantity numeric,p_category text,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_order rcat.orders%ROWTYPE;
  v_allocation rcat.inventory_order_allocations%ROWTYPE;
  v_previous rcat.inventory_exception_returns%ROWTYPE;
  v_total numeric;v_id uuid;
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,true);
  IF p_order IS NULL OR p_item IS NULL OR p_key IS NULL OR
     p_quantity IS NULL OR p_quantity<=0 OR p_quantity>1000000000 OR
     scale(p_quantity)>3 OR
     p_category IS NULL OR p_category NOT IN
       ('unused_unopened','kitchen_error_unconsumed') OR
     p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 10 AND 200 THEN
    RAISE EXCEPTION 'Invalid recoverable stock return'
      USING ERRCODE='22023';
  END IF;
  -- Serialize requests and approvals for an Order (including concurrent
  -- different ingredient requests) with the existing Order transition lock.
  SELECT * INTO v_order FROM rcat.orders
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_previous FROM rcat.inventory_exception_returns
    WHERE tenant_id=p_tenant AND store_id=p_store AND idempotency_key=p_key;
  IF FOUND THEN
    IF v_previous.order_id<>p_order OR v_previous.item_id<>p_item
      OR v_previous.created_by<>v_actor OR v_previous.quantity<>p_quantity
      OR v_previous.category<>p_category OR v_previous.reason<>trim(p_reason) THEN
      RAISE EXCEPTION 'Stock return retry payload changed'
        USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('requestId',v_previous.id,
      'state',v_previous.state,'replayed',true);
  END IF;
  IF v_order.status NOT IN ('preparing','served') THEN
    RAISE EXCEPTION 'Stock return requires kitchen preparation'
      USING ERRCODE='P0008';
  END IF;
  SELECT * INTO v_allocation FROM rcat.inventory_order_allocations
    WHERE tenant_id=p_tenant AND store_id=p_store
      AND order_id=p_order AND item_id=p_item;
  IF NOT FOUND OR v_allocation.returned_at IS NOT NULL THEN
    RAISE EXCEPTION 'No returnable Order allocation'
      USING ERRCODE='P0008';
  END IF;
  SELECT COALESCE(sum(quantity),0) INTO v_total
    FROM rcat.inventory_exception_returns
    WHERE tenant_id=p_tenant AND store_id=p_store
      AND order_id=p_order AND item_id=p_item AND state='approved';
  IF p_quantity>v_allocation.quantity-v_total THEN
    RAISE EXCEPTION 'Stock return exceeds original allocation'
      USING ERRCODE='P0008';
  END IF;
  INSERT INTO rcat.inventory_exception_returns(
    tenant_id,store_id,order_id,item_id,idempotency_key,
    quantity,category,reason,created_by
  ) VALUES(p_tenant,p_store,p_order,p_item,p_key,
    p_quantity,p_category,trim(p_reason),v_actor)
  RETURNING id INTO v_id;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
    VALUES(p_tenant,v_actor,'inventory.exception.requested',v_id,
      jsonb_build_object('storeId',p_store,'orderId',p_order,'itemId',p_item,
        'quantity',p_quantity::text,'category',p_category));
  RETURN jsonb_build_object('requestId',v_id,'state','pending','replayed',false);
END $$;

CREATE FUNCTION rcat_private.inventory_review_exception_return(
  p_digest bytea,p_tenant uuid,p_store uuid,p_request uuid,p_approve boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_order_id uuid;v_order rcat.orders%ROWTYPE;
  v_request rcat.inventory_exception_returns%ROWTYPE;
  v_allocation rcat.inventory_order_allocations%ROWTYPE;
  v_item rcat.inventory_items%ROWTYPE;
  v_total numeric;v_new numeric;v_movement uuid;
  v_state text;
BEGIN
  v_actor:=rcat_private._inventory_actor(p_digest,p_tenant,p_store,true);
  IF p_request IS NULL OR p_approve IS NULL THEN
    RAISE EXCEPTION 'Invalid review decision' USING ERRCODE='22023';
  END IF;
  v_state:=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  -- Order first, then request, then ingredient: same lock order as requester
  -- and kitchen fulfilment. The Order lock serializes cumulative returns.
  SELECT order_id INTO v_order_id FROM rcat.inventory_exception_returns
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_order FROM rcat.orders
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=v_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_request FROM rcat.inventory_exception_returns
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
  IF v_request.state=v_state AND v_request.reviewed_by=v_actor THEN
    RETURN jsonb_build_object('requestId',p_request,'state',v_state,
      'movementId',(SELECT m.id FROM rcat.inventory_movements m
        WHERE m.tenant_id=p_tenant AND m.store_id=p_store
          AND m.exception_return_id=p_request),'replayed',true);
  END IF;
  IF v_request.state<>'pending' OR v_request.created_by=v_actor THEN
    RAISE EXCEPTION 'Independent reviewer required or request closed'
      USING ERRCODE='P0007';
  END IF;
  IF p_approve THEN
    IF v_order.status NOT IN ('preparing','served') THEN
      RAISE EXCEPTION 'Order no longer eligible'
        USING ERRCODE='P0008';
    END IF;
    SELECT * INTO v_allocation FROM rcat.inventory_order_allocations
      WHERE tenant_id=p_tenant AND store_id=p_store
        AND order_id=v_request.order_id AND item_id=v_request.item_id;
    IF NOT FOUND OR v_allocation.returned_at IS NOT NULL THEN
      RAISE EXCEPTION 'Allocation no longer available'
        USING ERRCODE='P0008';
    END IF;
    SELECT COALESCE(sum(quantity),0) INTO v_total
      FROM rcat.inventory_exception_returns
      WHERE tenant_id=p_tenant AND store_id=p_store
        AND order_id=v_request.order_id AND item_id=v_request.item_id
        AND state='approved';
    IF v_request.quantity>v_allocation.quantity-v_total THEN
      RAISE EXCEPTION 'Stock return exceeds original allocation'
        USING ERRCODE='P0008';
    END IF;
    SELECT * INTO v_item FROM rcat.inventory_items
      WHERE tenant_id=p_tenant AND store_id=p_store
        AND id=v_request.item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ingredient unavailable'
      USING ERRCODE='42501'; END IF;
    v_new:=v_item.on_hand+v_request.quantity;
    IF v_new>1000000000000 THEN
      RAISE EXCEPTION 'Returned stock exceeds ledger limit'
        USING ERRCODE='P0008';
    END IF;
    UPDATE rcat.inventory_items SET
      on_hand=v_new,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND store_id=p_store AND id=v_request.item_id;
    INSERT INTO rcat.inventory_movements(
      tenant_id,store_id,item_id,idempotency_key,kind,delta,
      quantity_before,quantity_after,reason,actor_user_id,order_id,
      exception_return_id
    ) VALUES(p_tenant,p_store,v_request.item_id,p_request,'exception_return',
      v_request.quantity,v_item.on_hand,v_new,v_request.reason,v_actor,
      v_request.order_id,p_request)
    RETURNING id INTO v_movement;
  END IF;
  UPDATE rcat.inventory_exception_returns SET
    state=v_state,reviewed_by=v_actor,reviewed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND store_id=p_store AND id=p_request;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
    VALUES(p_tenant,v_actor,'inventory.exception.'||v_state,p_request,
      jsonb_build_object('storeId',p_store,'orderId',v_request.order_id,
        'itemId',v_request.item_id,'quantity',v_request.quantity::text,
        'category',v_request.category,'movementId',v_movement));
  RETURN jsonb_build_object('requestId',p_request,'state',v_state,
    'movementId',v_movement,'replayed',false);
END $$;

REVOKE ALL ON FUNCTION rcat_private.inventory_exception_return_view(
  bytea,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_request_exception_return(
  bytea,uuid,uuid,uuid,uuid,uuid,numeric,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.inventory_review_exception_return(
  bytea,uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_exception_return_view(
  bytea,uuid,uuid,uuid) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_request_exception_return(
  bytea,uuid,uuid,uuid,uuid,uuid,numeric,text,text) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.inventory_review_exception_return(
  bytea,uuid,uuid,uuid,boolean) TO rcat_auth;
