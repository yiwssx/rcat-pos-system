-- G2 operational Bills are named aggregations of independent Orders belonging
-- to exactly ONE table visit. Bills never settle or merge payment obligations.
-- Each Order remains the sole future unit of payment (G5 per-Order PromptPay).
ALTER TABLE rcat.table_ordering_visits
  ADD CONSTRAINT table_visit_bill_scope_key
  UNIQUE (tenant_id,store_id,table_id,id);

CREATE TABLE rcat.bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  table_id uuid NOT NULL,
  visit_id uuid NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,store_id,id),
  FOREIGN KEY (tenant_id,store_id,table_id,visit_id)
    REFERENCES rcat.table_ordering_visits(tenant_id,store_id,table_id,id)
    ON DELETE RESTRICT
);
CREATE INDEX bills_store_created_idx
  ON rcat.bills (tenant_id,store_id,created_at DESC);

ALTER TABLE rcat.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.bills FORCE ROW LEVEL SECURITY;
CREATE POLICY bills_tenant_read ON rcat.bills
  FOR SELECT TO rcat_app
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT ON rcat.bills TO rcat_app;

-- Add the visit identifier to the existing merchant inbox so a cashier can
-- open a Bill for an actual Order visit without a leaked table token.
CREATE OR REPLACE FUNCTION rcat_private.merchant_order_inbox(
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
    'orderId',o.id,'visitId',o.visit_id,'tableId',o.table_id,'amountSatang',o.amount_satang,
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


-- Idempotent, concurrent-safe creation: one operational Bill per visit, only
-- after at least one real Order exists. Role, tenant and store checked in DB.
CREATE FUNCTION rcat_private.create_operational_bill(
  p_session_digest bytea,p_tenant_id uuid,p_store_id uuid,p_visit_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;v_visit rcat.table_ordering_visits%ROWTYPE;
  v_bill uuid;v_created boolean:=false;
BEGIN
  SELECT actor_id,staff_role INTO v_actor,v_role
  FROM rcat_private._order_staff_actor(
    p_session_digest,p_tenant_id,p_store_id);
  IF v_role NOT IN ('owner','manager','cashier') THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;
  IF p_visit_id IS NULL THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_visit FROM rcat.table_ordering_visits
  WHERE id=p_visit_id AND tenant_id=p_tenant_id AND store_id=p_store_id
  FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM rcat.orders o
    WHERE o.tenant_id=p_tenant_id AND o.store_id=p_store_id
      AND o.visit_id=p_visit_id
  ) THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;

  INSERT INTO rcat.bills(tenant_id,store_id,table_id,visit_id,created_by)
  VALUES (p_tenant_id,p_store_id,v_visit.table_id,p_visit_id,v_actor)
  ON CONFLICT(visit_id) DO NOTHING RETURNING id INTO v_bill;

  IF v_bill IS NULL THEN
    SELECT id INTO v_bill FROM rcat.bills
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id
      AND visit_id=p_visit_id;
  ELSE
    v_created:=true;
    INSERT INTO rcat.audit_events(
      tenant_id,actor_user_id,action,subject_id,metadata
    ) VALUES (
      p_tenant_id,v_actor,'bill.operational.created',v_bill,
      jsonb_build_object('storeId',p_store_id,'visitId',p_visit_id)
    );
  END IF;
  RETURN jsonb_build_object('billId',v_bill,'created',v_created);
END $$;

-- Always derive aggregates from immutable server-priced Order snapshots.
-- Cancellation is an operational exclusion, NOT a refund or payment reversal.
CREATE FUNCTION rcat_private.operational_bill_snapshot(
  p_session_digest bytea,p_tenant_id uuid,p_store_id uuid,
  p_bill_id uuid,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_bill rcat.bills%ROWTYPE;v_order_count bigint;
  v_operational bigint;v_cancelled bigint;v_orders jsonb;
BEGIN
  PERFORM 1 FROM rcat_private._order_staff_actor(
    p_session_digest,p_tenant_id,p_store_id);
  IF p_bill_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid Bill request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_bill FROM rcat.bills
  WHERE id=p_bill_id AND tenant_id=p_tenant_id AND store_id=p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill unavailable' USING ERRCODE='42501';
  END IF;

  SELECT count(*),
    coalesce(sum(CASE WHEN status<>'cancelled'
       THEN amount_satang ELSE 0 END),0),
    coalesce(sum(CASE WHEN status='cancelled'
       THEN amount_satang ELSE 0 END),0)
  INTO v_order_count,v_operational,v_cancelled
  FROM rcat.orders
  WHERE tenant_id=p_tenant_id AND store_id=p_store_id
    AND table_id=v_bill.table_id AND visit_id=v_bill.visit_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'orderId',o.id,'amountSatang',o.amount_satang,
      'currency',o.currency,'status',o.status,
      'paymentState',o.payment_state,'createdAt',o.created_at
    ) ORDER BY o.created_at,o.id),'[]'::jsonb)
  INTO v_orders
  FROM (
    SELECT * FROM rcat.orders
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id
      AND table_id=v_bill.table_id AND visit_id=v_bill.visit_id
    ORDER BY created_at,id LIMIT p_limit
  ) o;

  RETURN jsonb_build_object(
    'billId',v_bill.id,'tableId',v_bill.table_id,
    'visitId',v_bill.visit_id,'createdAt',v_bill.created_at,
    'orderCount',v_order_count,'hasMore',v_order_count>p_limit,
    'operationalTotalSatang',v_operational,
    'cancelledTotalSatang',v_cancelled,'currency','THB',
    'orders',v_orders
  );
END $$;

REVOKE ALL ON FUNCTION rcat_private.create_operational_bill(bytea,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.operational_bill_snapshot(bytea,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.create_operational_bill(bytea,uuid,uuid,uuid) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.operational_bill_snapshot(bytea,uuid,uuid,uuid,integer) TO rcat_auth;
