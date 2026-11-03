-- G2 merchant fulfilment: role-scoped Order inbox and audited, linear transitions.
-- Payment stays "not_requested"; Order amount/items are never mutated here.
CREATE FUNCTION rcat_private._order_staff_actor(
  p_digest bytea, p_tenant_id uuid, p_store_id uuid
) RETURNS TABLE(actor_id uuid, staff_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid; v_role text;
BEGIN
  v_actor := rcat_private._require_session_actor(p_digest);
  SELECT m.role INTO v_role
  FROM rcat.tenant_memberships m
  WHERE m.tenant_id=p_tenant_id AND m.user_id=v_actor
    AND m.role IN ('owner','manager','cashier','kitchen')
  FOR SHARE;
  IF v_role IS NULL OR NOT EXISTS (
    SELECT 1 FROM rcat.stores s
    WHERE s.tenant_id=p_tenant_id AND s.id=p_store_id
  ) THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;
  actor_id:=v_actor;
  staff_role:=v_role;
  RETURN NEXT;
END $$;

CREATE FUNCTION rcat_private.merchant_order_inbox(
  p_digest bytea, p_tenant_id uuid, p_store_id uuid,
  p_status text DEFAULT NULL, p_limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_orders jsonb;
BEGIN
  PERFORM 1 FROM rcat_private._order_staff_actor(
    p_digest,p_tenant_id,p_store_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR (p_status IS NOT NULL AND p_status NOT IN
      ('submitted','accepted','preparing','served','cancelled'))
  THEN RAISE EXCEPTION 'Invalid inbox filter' USING ERRCODE='22023'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'orderId',o.id,'tableId',o.table_id,'amountSatang',o.amount_satang,
    'currency',o.currency,'status',o.status,
    'paymentState',o.payment_state,'createdAt',o.created_at,
    'updatedAt',o.updated_at,'items',
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'productName',i.product_name,'quantity',i.quantity,
      'basePriceSatang',i.base_price_satang,
      'unitPriceSatang',i.unit_price_satang,
      'lineTotalSatang',i.line_total_satang,
      'options',i.option_snapshots
    ) ORDER BY i.created_at,i.id),'[]'::jsonb)
      FROM rcat.order_items i
      WHERE i.tenant_id=o.tenant_id AND i.store_id=o.store_id
        AND i.order_id=o.id)
  ) ORDER BY o.created_at DESC,o.id DESC),'[]'::jsonb)
  INTO v_orders
  FROM (
    SELECT * FROM rcat.orders
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id
      AND (p_status IS NULL OR status=p_status)
    ORDER BY created_at DESC,id DESC LIMIT p_limit
  ) o;
  RETURN jsonb_build_object('orders',v_orders);
END $$;

CREATE FUNCTION rcat_private.transition_merchant_order(
  p_digest bytea, p_tenant_id uuid, p_store_id uuid, p_order_id uuid,
  p_expected text, p_next text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid; v_role text; v_order rcat.orders%ROWTYPE;
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
  ) THEN
    RAISE EXCEPTION 'Order transition not permitted' USING ERRCODE='42501';
  END IF;

  UPDATE rcat.orders
  SET status=p_next,updated_at=clock_timestamp()
  WHERE id=v_order.id;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata
  ) VALUES (
    p_tenant_id,v_actor,'order.status.changed',v_order.id,
    jsonb_build_object('storeId',p_store_id,'from',p_expected,'to',p_next)
  );
  RETURN jsonb_build_object(
    'orderId',v_order.id,'status',p_next,
    'amountSatang',v_order.amount_satang,'currency',v_order.currency,
    'paymentState',v_order.payment_state
  );
END $$;

REVOKE ALL ON FUNCTION rcat_private._order_staff_actor(bytea,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.merchant_order_inbox(bytea,uuid,uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.transition_merchant_order(bytea,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_order_inbox(bytea,uuid,uuid,text,integer) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.transition_merchant_order(bytea,uuid,uuid,uuid,text,text) TO rcat_auth;
