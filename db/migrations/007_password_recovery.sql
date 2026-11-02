-- Password recovery is isolated from tenant data and requires an email proof.
-- All writes occur through narrow, owner-executed SECURITY DEFINER functions.
CREATE TABLE rcat_private.password_recovery (
  user_id uuid PRIMARY KEY REFERENCES rcat.users(id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest)=32),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '20 minutes'),
  CHECK (expires_at>requested_at)
);
REVOKE ALL ON rcat_private.password_recovery FROM PUBLIC;

CREATE FUNCTION rcat_private.request_password_recovery(
  p_email text, p_token_digest bytea
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_user uuid; v_accepted boolean:=false;
BEGIN
  IF p_email IS NULL OR p_email <> lower(trim(p_email))
    OR length(p_email) NOT BETWEEN 3 AND 254
    OR p_token_digest IS NULL OR octet_length(p_token_digest)<>32
  THEN RAISE EXCEPTION 'Invalid recovery request' USING ERRCODE='22023'; END IF;

  -- Lock account to serialize issuance with password changes.
  SELECT id INTO v_user FROM rcat.users
   WHERE email=p_email AND is_active FOR UPDATE;
  IF v_user IS NULL THEN RETURN false; END IF;

  INSERT INTO rcat_private.password_recovery AS r (user_id,token_digest)
    VALUES(v_user,p_token_digest)
  ON CONFLICT(user_id) DO UPDATE SET
    token_digest=EXCLUDED.token_digest,
    requested_at=now(),
    expires_at=now()+interval '20 minutes'
  WHERE r.requested_at<=now()-interval '60 seconds'
  RETURNING true INTO v_accepted;
  RETURN COALESCE(v_accepted,false);
END $$;

CREATE FUNCTION rcat_private.complete_password_recovery(
  p_token_digest bytea, p_new_hash text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_row rcat_private.password_recovery%ROWTYPE;
BEGIN
  IF p_token_digest IS NULL OR octet_length(p_token_digest)<>32
    OR p_new_hash IS NULL OR length(p_new_hash) NOT BETWEEN 40 AND 300
    OR left(p_new_hash,7)<>'scrypt$'
  THEN RAISE EXCEPTION 'Invalid password recovery request' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM rcat_private.password_recovery
    WHERE token_digest=p_token_digest FOR UPDATE;
  IF NOT FOUND OR v_row.expires_at<=now() THEN
    RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='42501';
  END IF;

  -- Protect concurrent password writes and in-flight login token issuance.
  PERFORM 1 FROM rcat.users WHERE id=v_row.user_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='42501';
  END IF;
  UPDATE rcat.users SET password_hash=p_new_hash WHERE id=v_row.user_id;
  UPDATE rcat_private.auth_sessions SET revoked_at=now()
    WHERE user_id=v_row.user_id AND revoked_at IS NULL;
  DELETE FROM rcat_private.password_recovery WHERE user_id=v_row.user_id;
  -- Account-level audit with no tenant association cannot go into tenant audit.
  -- A dedicated authentication security-events ledger is required before production.
  RETURN true;
END $$;

-- Prevent issuing a new session with a password that was valid before a
-- concurrent recovery: compare the observed hash under an account row lock.
CREATE FUNCTION rcat_private.issue_session_if_current(
  p_user_id uuid, p_observed_hash text,
  p_token_digest bytea, p_csrf_digest bytea
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_valid boolean;
BEGIN
  IF p_token_digest IS NULL OR octet_length(p_token_digest)<>32
    OR p_csrf_digest IS NULL OR octet_length(p_csrf_digest)<>32
  THEN RAISE EXCEPTION 'Invalid session request' USING ERRCODE='22023'; END IF;
  SELECT (u.is_active AND u.password_hash=p_observed_hash) INTO v_valid
    FROM rcat.users u WHERE u.id=p_user_id FOR UPDATE;
  IF NOT COALESCE(v_valid,false) THEN RETURN false; END IF;
  INSERT INTO rcat_private.auth_sessions
    (user_id,token_digest,csrf_digest,expires_at)
    VALUES(p_user_id,p_token_digest,p_csrf_digest,now()+interval '12 hours');
  RETURN true;
END $$;

-- If transport fails unambiguously, withdraw the exact unsent recovery token.
-- A future persistent outbox will handle ambiguous/timeout delivery outcomes.
CREATE FUNCTION rcat_private.cancel_password_recovery(
  p_token_digest bytea
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM rcat_private.password_recovery WHERE token_digest=p_token_digest;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count>0;
END $$;

REVOKE ALL ON FUNCTION rcat_private.request_password_recovery(text,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.complete_password_recovery(bytea,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.cancel_password_recovery(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.issue_session_if_current(uuid,text,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.request_password_recovery(text,bytea) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.complete_password_recovery(bytea,text) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.cancel_password_recovery(bytea) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.issue_session_if_current(uuid,text,bytea,bytea) TO rcat_auth;

-- Withdraw only the exact unsent email claim, preserving a newer token.
CREATE FUNCTION rcat_private.cancel_email_registration(p_token_digest bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM rcat_private.pending_registrations
  WHERE token_digest=p_token_digest;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count>0;
END $$;
REVOKE ALL ON FUNCTION rcat_private.cancel_email_registration(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.cancel_email_registration(bytea) TO rcat_auth;
