-- G3: operational counts and ordered value ONLY. No cash, refunds, revenue,
-- settlement, payment verification or PromptPay status is represented here.
CREATE FUNCTION rcat_private.merchant_daily_operational_report(
  p_digest bytea, p_tenant_id uuid, p_store_id uuid, p_day date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_actor uuid; v_role text;
  v_start timestamptz; v_end timestamptz;
  v_stats jsonb; v_products jsonb;
  v_accept integer; v_serve integer;
BEGIN
  SELECT actor_id,staff_role INTO v_actor,v_role
  FROM rcat_private._order_staff_actor(p_digest,p_tenant_id,p_store_id);
  IF v_role NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'Report unavailable' USING ERRCODE='42501';
  END IF;
  IF p_day IS NULL OR p_day < DATE '2020-01-01'
      OR p_day > ((now() AT TIME ZONE 'Asia/Bangkok')::date+1)
  THEN
    RAISE EXCEPTION 'Invalid report business day' USING ERRCODE='22023';
  END IF;

  -- Half-open interval accounts for Asia/Bangkok business day boundaries.
  -- created_at is immutable, so a status change tomorrow does not move an
  -- Order into a different creation-day cohort.
  v_start := p_day::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_end := (p_day+1)::timestamp AT TIME ZONE 'Asia/Bangkok';

  SELECT jsonb_build_object(
    'orderCount',count(*)::integer,
    'statusCounts',jsonb_build_object(
      'submitted',count(*) FILTER(WHERE status='submitted'),
      'accepted',count(*) FILTER(WHERE status='accepted'),
      'preparing',count(*) FILTER(WHERE status='preparing'),
      'served',count(*) FILTER(WHERE status='served'),
      'cancelled',count(*) FILTER(WHERE status='cancelled')),
    'orderedAmountSatang',coalesce(sum(amount_satang),0)::text,
    'activeOrderedAmountSatang',coalesce(sum(amount_satang)
      FILTER(WHERE status<>'cancelled'),0)::text,
    'cancelledOrderedAmountSatang',coalesce(sum(amount_satang)
      FILTER(WHERE status='cancelled'),0)::text,
    'servedOrderedAmountSatang',coalesce(sum(amount_satang)
      FILTER(WHERE status='served'),0)::text)
  INTO v_stats
  FROM rcat.orders
  WHERE tenant_id=p_tenant_id AND store_id=p_store_id
    AND created_at>=v_start AND created_at<v_end;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'productId',x.product_id,'productName',x.product_name,
    'unitsOrdered',x.units::text,
    'orderedAmountSatang',x.total_satang::text)
    ORDER BY x.units DESC,x.product_name,x.product_id),'[]'::jsonb)
  INTO v_products
  FROM (
    SELECT i.product_id,i.product_name,sum(i.quantity) AS units,
      sum(i.line_total_satang) AS total_satang
    FROM rcat.order_items i
    JOIN rcat.orders o ON o.id=i.order_id
      AND o.tenant_id=i.tenant_id AND o.store_id=i.store_id
    WHERE o.tenant_id=p_tenant_id AND o.store_id=p_store_id
      AND o.created_at>=v_start AND o.created_at<v_end
      AND o.status<>'cancelled'
    GROUP BY i.product_id,i.product_name
    ORDER BY units DESC,i.product_name,i.product_id
    LIMIT 10
  ) x;

  SELECT round(avg(extract(epoch from a.accepted_at-o.created_at)))::integer,
         round(avg(extract(epoch from a.served_at-o.created_at)))::integer
  INTO v_accept,v_serve
  FROM rcat.orders o
  LEFT JOIN LATERAL (
    SELECT min(e.created_at) FILTER (WHERE e.metadata->>'to'='accepted')
      AS accepted_at,
      min(e.created_at) FILTER (WHERE e.metadata->>'to'='served')
      AS served_at
    FROM rcat.audit_events e
    WHERE e.tenant_id=p_tenant_id AND e.subject_id=o.id
      AND e.action='order.status.changed'
      AND e.metadata->>'storeId'=p_store_id::text
  ) a ON true
  WHERE o.tenant_id=p_tenant_id AND o.store_id=p_store_id
    AND o.created_at>=v_start AND o.created_at<v_end;

  RETURN jsonb_build_object(
    'day',p_day::text,
    'timezone','Asia/Bangkok',
    'snapshotType','ordered_not_paid',
    'paymentStatus','not_implemented',
    'orderCount',v_stats->'orderCount',
    'statusCounts',v_stats->'statusCounts',
    'orderedAmountSatang',v_stats->'orderedAmountSatang',
    'activeOrderedAmountSatang',v_stats->'activeOrderedAmountSatang',
    'cancelledOrderedAmountSatang',v_stats->'cancelledOrderedAmountSatang',
    'servedOrderedAmountSatang',v_stats->'servedOrderedAmountSatang',
    'avgSecondsToAccept',v_accept,
    'avgSecondsToServe',v_serve,
    'topProducts',v_products);
END $$;
REVOKE ALL ON FUNCTION rcat_private.merchant_daily_operational_report(
  bytea,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_daily_operational_report(
  bytea,uuid,uuid,date) TO rcat_auth;
