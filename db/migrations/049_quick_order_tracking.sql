-- G6 cross-feature correction: one counter Order gets the existing
-- order-only tracking/payment capability, never the public Store QR.
-- Tracking is not Payment creation, confirmation or an append credential.
CREATE FUNCTION rcat_private.bind_quick_order_tracking(
  p_order_id uuid,p_session_digest bytea,p_tracking_digest bytea
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_scope jsonb;v_existing bytea;
BEGIN
  IF p_order_id IS NULL OR p_session_digest IS NULL
    OR octet_length(p_session_digest)<>32
    OR p_tracking_digest IS NULL OR octet_length(p_tracking_digest)<>32
  THEN RAISE EXCEPTION 'Quick Order unavailable' USING ERRCODE='42501'; END IF;

  -- Resolve and hold the store lock before touching any Order. Revalidate
  -- the grant and generation after that lock (rotation/closure/expiry).
  v_scope:=rcat_private.resolve_store_guest_session(p_session_digest);
  SELECT o.tracking_token_digest INTO v_existing
  FROM rcat.orders o
  JOIN rcat_private.store_guest_sessions g
    ON g.id=o.quick_session_id AND g.tenant_id=o.tenant_id AND g.store_id=o.store_id
  JOIN rcat_private.store_public_qrs q
    ON q.tenant_id=g.tenant_id AND q.store_id=g.store_id
    AND q.generation=g.qr_generation
  JOIN rcat_private.store_service_modes m
    ON m.tenant_id=g.tenant_id AND m.store_id=g.store_id
    AND m.revision=g.mode_revision AND m.service_mode IN ('quick','hybrid')
  WHERE o.id=p_order_id
    AND g.id=(v_scope->>'guestSessionId')::uuid
    AND g.token_digest=p_session_digest
    AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quick Order unavailable' USING ERRCODE='42501';
  END IF;
  IF v_existing IS NULL THEN
    UPDATE rcat.orders SET tracking_token_digest=p_tracking_digest
    WHERE id=p_order_id;
  ELSIF v_existing<>p_tracking_digest THEN
    RAISE EXCEPTION 'Tracking capability mismatch' USING ERRCODE='23505';
  END IF;
END $$;
REVOKE ALL ON FUNCTION rcat_private.bind_quick_order_tracking(uuid,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.bind_quick_order_tracking(uuid,bytea,bytea) TO rcat_auth;
