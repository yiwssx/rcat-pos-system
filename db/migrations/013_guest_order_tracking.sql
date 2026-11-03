-- G2: independent, order-scoped guest tracking capability, derived by the
-- API from the active visit secret and retry-stable checkout key. The raw
-- capability never enters PostgreSQL. Existing historical Orders remain
-- unreadable by guests until the original checkout can bind a capability.
ALTER TABLE rcat.orders
  ADD COLUMN tracking_token_digest bytea
    CHECK (tracking_token_digest IS NULL OR octet_length(tracking_token_digest)=32);

CREATE UNIQUE INDEX orders_tracking_token_digest_idx
  ON rcat.orders(tracking_token_digest)
  WHERE tracking_token_digest IS NOT NULL;

-- Called in the SAME database transaction as place_guest_order. The SQL
-- checkout routine has already checked live visit, cart and idempotency.
-- A failed bind rolls the Order insert back, avoiding orphaned inaccessible
-- Order submissions. A replay returns the same capability without storing
-- the raw secret or allowing an attacker to overwrite an existing digest.
CREATE FUNCTION rcat_private.bind_guest_order_tracking(
  p_order_id uuid, p_visit_digest bytea, p_idempotency_key text,
  p_tracking_digest bytea
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_existing bytea;
BEGIN
  IF p_order_id IS NULL
    OR p_visit_digest IS NULL OR octet_length(p_visit_digest)<>32
    OR p_tracking_digest IS NULL OR octet_length(p_tracking_digest)<>32
    OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 16 AND 96
  THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;

  SELECT o.tracking_token_digest INTO v_existing
  FROM rcat.orders o
  JOIN rcat.table_ordering_visits v
    ON v.id=o.visit_id AND v.tenant_id=o.tenant_id
       AND v.store_id=o.store_id
  WHERE o.id=p_order_id AND v.token_digest=p_visit_digest
    AND o.idempotency_key=p_idempotency_key
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;

  IF v_existing IS NULL THEN
    UPDATE rcat.orders
      SET tracking_token_digest=p_tracking_digest
      WHERE id=p_order_id;
  ELSIF v_existing<>p_tracking_digest THEN
    RAISE EXCEPTION 'Tracking capability mismatch' USING ERRCODE='23505';
  END IF;
END $$;

-- The bearer token is the ONLY guest authorization for this read.
-- Do not accept a visit token, table QR, tenant/store IDs, browser cookies or
-- a bare Order UUID as proof. No customer PII, item details or actor audit.
CREATE FUNCTION rcat_private.guest_order_status(
  p_order_id uuid, p_tracking_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_order rcat.orders%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR p_tracking_digest IS NULL
    OR octet_length(p_tracking_digest)<>32
  THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_order
  FROM rcat.orders
  WHERE id=p_order_id AND tracking_token_digest=p_tracking_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';
  END IF;

  RETURN jsonb_build_object(
    'orderId',v_order.id,'status',v_order.status,
    'paymentState',v_order.payment_state,
    'amountSatang',v_order.amount_satang,
    'currency',v_order.currency,
    'createdAt',v_order.created_at,
    'updatedAt',v_order.updated_at
  );
END $$;

REVOKE ALL ON FUNCTION rcat_private.bind_guest_order_tracking(uuid,bytea,text,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.guest_order_status(uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.bind_guest_order_tracking(uuid,bytea,text,bytea) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.guest_order_status(uuid,bytea) TO rcat_auth;
