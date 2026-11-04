-- G3 targeted, staff-scoped authoritative snapshot recovery for Outbox
-- references beyond any keyset Inbox page-count/age limit. No Payment logic.
CREATE FUNCTION rcat_private.merchant_order_lookup_ids(
  p_digest bytea,p_tenant_id uuid,p_store_id uuid,p_order_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_orders jsonb;
BEGIN
  PERFORM 1 FROM rcat_private._order_staff_actor(
    p_digest,p_tenant_id,p_store_id);

  IF p_order_ids IS NULL OR cardinality(p_order_ids) NOT BETWEEN 1 AND 50
    OR (SELECT count(DISTINCT x) FROM unnest(p_order_ids) x)<>cardinality(p_order_ids)
  THEN RAISE EXCEPTION 'Invalid Order lookup ids' USING ERRCODE='22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'orderId',o.id,'visitId',o.visit_id,'tableId',o.table_id,
    'amountSatang',o.amount_satang,'currency',o.currency,
    'status',o.status,'paymentState',o.payment_state,
    'createdAt',o.created_at,'updatedAt',o.updated_at,
    'items',(SELECT coalesce(jsonb_agg(jsonb_build_object(
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
  FROM rcat.orders o
  WHERE o.tenant_id=p_tenant_id AND o.store_id=p_store_id
    AND o.id=ANY(p_order_ids);

  -- Unknown, foreign-store or deleted Order references are omitted rather
  -- than returning a 404 that could reveal whether an ID exists elsewhere.
  -- The Merchant client MUST check complete coverage before Outbox ack.
  RETURN jsonb_build_object('orders',v_orders);
END $$;
REVOKE ALL ON FUNCTION rcat_private.merchant_order_lookup_ids(
  bytea,uuid,uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_order_lookup_ids(
  bytea,uuid,uuid,uuid[]) TO rcat_auth;
