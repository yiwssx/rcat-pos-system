-- G3: keyset-paginated merchant Order Inbox, independent of mutable status.
-- The existing /orders API contract stays valid; this new SQL function is
-- exposed only via a session + membership authorized NestJS API.
-- Cursor is created_at with full PostgreSQL microsecond precision + order UUID.
-- Using a JS Date/ISO millisecond roundtrip would skip timestamp ties.
CREATE INDEX orders_store_created_id_idx
  ON rcat.orders(tenant_id,store_id,created_at DESC,id DESC);

CREATE FUNCTION rcat_private.merchant_order_inbox_page(
  p_digest bytea,p_tenant_id uuid,p_store_id uuid,
  p_status text DEFAULT NULL,p_limit integer DEFAULT 50,
  p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_orders jsonb;v_has_more boolean;v_next text;
BEGIN
  PERFORM 1 FROM rcat_private._order_staff_actor(
    p_digest,p_tenant_id,p_store_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR (p_status IS NOT NULL AND p_status NOT IN
      ('submitted','accepted','preparing','served','cancelled'))
    OR (p_before_at IS NULL)<>(p_before_id IS NULL)
  THEN
    RAISE EXCEPTION 'Invalid Order page filter' USING ERRCODE='22023';
  END IF;

  WITH candidate AS MATERIALIZED (
    SELECT * FROM rcat.orders
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id
      AND (p_status IS NULL OR status=p_status)
      AND (p_before_at IS NULL
        OR (created_at,id)<(p_before_at,p_before_id))
    ORDER BY created_at DESC,id DESC
    LIMIT p_limit+1
  ), visible AS MATERIALIZED (
    SELECT * FROM candidate ORDER BY created_at DESC,id DESC LIMIT p_limit
  )
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
  ) ORDER BY o.created_at DESC,o.id DESC),'[]'::jsonb),
    (SELECT count(*)>p_limit FROM candidate),
    (SELECT to_char(v.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'_'||v.id::text
     FROM visible v
     ORDER BY v.created_at ASC,v.id ASC LIMIT 1)
  INTO v_orders,v_has_more,v_next
  FROM visible o;

  RETURN jsonb_build_object(
    'orders',v_orders,'hasMore',v_has_more,
    'nextCursor',CASE WHEN v_has_more THEN v_next ELSE NULL END
  );
END $$;
REVOKE ALL ON FUNCTION rcat_private.merchant_order_inbox_page(
  bytea,uuid,uuid,text,integer,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_order_inbox_page(
  bytea,uuid,uuid,text,integer,timestamptz,uuid) TO rcat_auth;
