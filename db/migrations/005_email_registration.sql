-- Email proof before account activation: NO direct INSERT privileges for rcat_auth.
-- This migration only enables CI/test-mode registration; external mail provider pending.
CREATE TABLE rcat_private.pending_registrations (
  email text PRIMARY KEY CHECK (
    email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254
  ),
  password_hash text NOT NULL CHECK (
    length(password_hash) BETWEEN 40 AND 300
    AND left(password_hash, 7) = 'scrypt$'
  ),
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  CHECK (expires_at > requested_at)
);
REVOKE ALL ON rcat_private.pending_registrations FROM PUBLIC;

CREATE FUNCTION rcat_private.request_email_registration(
  p_email text, p_password_hash text, p_token_digest bytea
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE accepted boolean := false;
BEGIN
  IF p_email IS NULL OR p_email <> lower(trim(p_email))
    OR length(p_email) NOT BETWEEN 3 AND 254
    OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    OR p_password_hash IS NULL
    OR length(p_password_hash) NOT BETWEEN 40 AND 300
    OR left(p_password_hash, 7) <> 'scrypt$'
    OR p_token_digest IS NULL OR octet_length(p_token_digest) <> 32
  THEN RAISE EXCEPTION 'Invalid registration details' USING ERRCODE = '22023';
  END IF;

  -- Existing identities are never modified or implicitly claimed.
  IF EXISTS (SELECT 1 FROM rcat.users WHERE email = p_email) THEN
    RETURN false;
  END IF;
  -- Throttle repeat requests for the same pending email in the database.
  INSERT INTO rcat_private.pending_registrations AS p
    (email, password_hash, token_digest)
  VALUES (p_email, p_password_hash, p_token_digest)
  ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    token_digest = EXCLUDED.token_digest,
    requested_at = now(),
    expires_at = now() + interval '30 minutes'
  WHERE p.requested_at <= now() - interval '60 seconds'
  RETURNING true INTO accepted;
  RETURN COALESCE(accepted, false);
END $$;

CREATE FUNCTION rcat_private.complete_email_registration(p_token_digest bytea)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE pending rcat_private.pending_registrations%ROWTYPE; new_user uuid;
BEGIN
  IF p_token_digest IS NULL OR octet_length(p_token_digest) <> 32 THEN
    RAISE EXCEPTION 'Verification unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT p.* INTO pending
    FROM rcat_private.pending_registrations p
    WHERE p.token_digest = p_token_digest
    FOR UPDATE;
  IF NOT FOUND OR pending.expires_at <= now() THEN
    RAISE EXCEPTION 'Verification unavailable' USING ERRCODE = '42501';
  END IF;
  INSERT INTO rcat.users(email,password_hash)
    VALUES (pending.email,pending.password_hash)
    ON CONFLICT(email) DO NOTHING
    RETURNING id INTO new_user;
  IF new_user IS NULL THEN
    RAISE EXCEPTION 'Verification unavailable' USING ERRCODE = '42501';
  END IF;
  DELETE FROM rcat_private.pending_registrations
    WHERE email = pending.email;
  RETURN new_user;
END $$;

REVOKE ALL ON FUNCTION rcat_private.request_email_registration(text,text,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.complete_email_registration(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.request_email_registration(text,text,bytea) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.complete_email_registration(bytea) TO rcat_auth;
