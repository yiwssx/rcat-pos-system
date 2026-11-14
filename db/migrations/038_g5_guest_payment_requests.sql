-- G5-M1: Guest-scoped logical Payment Request / QR issuance.
-- This is dormant by default: BOTH the API release flag and the store
-- receiver.enabled (DBA-only controlled pilot gate) must be true.
-- The existing Ordering QR and kitchen transitions stay independent.
-- Runtime roles have NO direct access to payment tables.
ALTER TABLE rcat.orders
  DROP CONSTRAINT orders_payment_state_check;
ALTER TABLE rcat.orders
  ADD CONSTRAINT orders_payment_state_check
    CHECK(payment_state IN ('not_requested','awaiting_payment'));

CREATE FUNCTION rcat_private.guest_order_payment_request(
  p_order_id uuid,p_tracking_digest bytea,p_release_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_order rcat.orders%ROWTYPE;
  v_request rcat.payment_requests%ROWTYPE;
  v_receiver rcat.store_promptpay_receivers%ROWTYPE;
BEGIN
  -- A public Order UUID, table/visit token or merchant role is NOT sufficient.
  IF p_order_id IS NULL OR p_tracking_digest IS NULL OR
     octet_length(p_tracking_digest)<>32 THEN
    RAISE EXCEPTION 'Payment request unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_order FROM rcat.orders
  WHERE id=p_order_id AND tracking_token_digest=p_tracking_digest
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request unavailable' USING ERRCODE='42501';
  END IF;

  -- The API's rollout opt-in must be affirmative. This check comes AFTER
  -- capability authorization to avoid Order enumeration via flag changes.
  -- No new payment is created for cancelled/zero-value Orders.
  IF p_release_enabled IS DISTINCT FROM true OR
     v_order.status='cancelled' OR v_order.amount_satang<1 THEN
    RETURN jsonb_build_object('available',false);
  END IF;

  -- Disabling the receiver stops exposing EVEN prior Payment QR data,
  -- pending explicit G6 operator policy for outstanding liabilities.
  -- It also prevents a stale recipient change from redirecting old debt.
  SELECT * INTO v_receiver
  FROM rcat.store_promptpay_receivers
  WHERE tenant_id=v_order.tenant_id AND store_id=v_order.store_id
    AND enabled=true
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('available',false);
  END IF;

  SELECT * INTO v_request FROM rcat.payment_requests
  WHERE tenant_id=v_order.tenant_id AND store_id=v_order.store_id
    AND order_id=v_order.id;
  IF NOT FOUND THEN
    -- No client-provided amount or receiver is accepted. The row lock on
    -- the Order serializes retries and preserves the first receiver snapshot.
    INSERT INTO rcat.payment_requests(
      tenant_id,store_id,order_id,amount_satang,currency,
      recipient_kind,recipient_identifier
    ) VALUES (
      v_order.tenant_id,v_order.store_id,v_order.id,
      v_order.amount_satang,v_order.currency,
      v_receiver.recipient_kind,v_receiver.recipient_identifier
    )
    RETURNING * INTO v_request;
  END IF;
  IF v_request.amount_satang<>v_order.amount_satang OR
     v_request.currency<>v_order.currency THEN
    RAISE EXCEPTION 'Payment snapshot mismatch' USING ERRCODE='P0009';
  END IF;

  -- Payment is separate from fulfilment. No Order status or stock changes.
  UPDATE rcat.orders SET payment_state='awaiting_payment'
  WHERE id=v_order.id AND payment_state='not_requested';

  RETURN jsonb_build_object(
    'available',true,'requestId',v_request.id,'orderId',v_order.id,
    'amountSatang',v_request.amount_satang,'currency',v_request.currency,
    'state',v_request.state,'receiverKind',v_request.recipient_kind,
    'receiverId',v_request.recipient_identifier,
    'createdAt',v_request.created_at
  );
END $$;

REVOKE ALL ON FUNCTION rcat_private.guest_order_payment_request(
  uuid,bytea,boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.guest_order_payment_request(
  uuid,bytea,boolean
) TO rcat_auth;
