-- G2 Order status history: the pre-existing audit row is committed in the
-- SAME transaction as each merchant status transition. No redundant mutable
-- event stream, no synthetic payment events and no backfill required.
CREATE INDEX audit_order_status_history_idx
  ON rcat.audit_events(tenant_id,subject_id,id)
  WHERE action='order.status.changed';

-- This helper has NO grants to runtime DB roles. The two public wrappers below
-- authorize before calling it. All Order/audit lookups remain tenant+store scoped.
CREATE FUNCTION rcat_private._order_status_timeline(
  p_tenant_id uuid,p_store_id uuid,p_order_id uuid,p_include_actor boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_order rcat.orders%ROWTYPE; v_changes jsonb;
BEGIN
  SELECT * INTO v_order FROM rcat.orders
  WHERE id=p_order_id AND tenant_id=p_tenant_id AND store_id=p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'eventId',a.id,'status',a.metadata->>'to',
      'fromStatus',a.metadata->>'from','occurredAt',a.created_at
    ) || CASE WHEN p_include_actor THEN
      jsonb_build_object('actorUserId',a.actor_user_id)
    ELSE '{}'::jsonb END
    ORDER BY a.id ASC
  ),'[]'::jsonb)
  INTO v_changes
  FROM rcat.audit_events a
  WHERE a.tenant_id=p_tenant_id AND a.subject_id=p_order_id
    AND a.action='order.status.changed'
    AND a.metadata->>'storeId'=p_store_id::text;

  RETURN jsonb_build_object(
    'orderId',v_order.id,'status',v_order.status,
    'paymentState',v_order.payment_state,
    'events',jsonb_build_array(jsonb_build_object(
      'eventId',NULL,'status','submitted',
      'fromStatus',NULL,'occurredAt',v_order.created_at
    )) || v_changes
  );
END $$;

-- Anonymous guest read: a capability is valid only for THIS Order.
-- Never return actor IDs, free-form audit metadata or other Orders.
CREATE FUNCTION rcat_private.guest_order_history(
  p_order_id uuid,p_tracking_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_tenant uuid;v_store uuid;
BEGIN
  IF p_order_id IS NULL OR p_tracking_digest IS NULL
    OR octet_length(p_tracking_digest)<>32 THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;
  SELECT tenant_id,store_id INTO v_tenant,v_store
  FROM rcat.orders
  WHERE id=p_order_id AND tracking_token_digest=p_tracking_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;
  RETURN rcat_private._order_status_timeline(
    v_tenant,v_store,p_order_id,false);
END $$;

-- Merchant read: existing staff session and tenant/store RBAC gate.
-- The actor ID is relevant to merchant traceability, not exposed to guests.
CREATE FUNCTION rcat_private.merchant_order_history(
  p_session_digest bytea,p_tenant_id uuid,
  p_store_id uuid,p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  PERFORM 1 FROM rcat_private._order_staff_actor(
    p_session_digest,p_tenant_id,p_store_id);
  RETURN rcat_private._order_status_timeline(
    p_tenant_id,p_store_id,p_order_id,true);
END $$;

REVOKE ALL ON FUNCTION rcat_private._order_status_timeline(uuid,uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.guest_order_history(uuid,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.merchant_order_history(bytea,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.guest_order_history(uuid,bytea) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_order_history(bytea,uuid,uuid,uuid) TO rcat_auth;
