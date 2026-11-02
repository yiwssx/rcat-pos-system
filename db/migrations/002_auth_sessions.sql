-- Separate restricted authentication storage, NO application login endpoint yet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rcat_auth') THEN
    CREATE ROLE rcat_auth NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
CREATE SCHEMA rcat_private;
REVOKE ALL ON SCHEMA rcat_private FROM PUBLIC;

CREATE TABLE rcat_private.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES rcat.users(id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest)=32),
  csrf_digest bytea NOT NULL CHECK (octet_length(csrf_digest)=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX auth_sessions_user_active_idx
  ON rcat_private.auth_sessions (user_id,expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_expiration_idx
  ON rcat_private.auth_sessions(expires_at);

-- Auth service role is NOT rcat_app; they must never share their credentials.
-- rcat_auth can verify passwords, look up token hashes and revoke its own session
-- records through a future authenticated service; it cannot access store tables.
GRANT USAGE ON SCHEMA rcat,rcat_private TO rcat_auth;
GRANT SELECT (id,email,password_hash,is_active) ON rcat.users TO rcat_auth;
GRANT SELECT,INSERT ON rcat_private.auth_sessions TO rcat_auth;
GRANT UPDATE (revoked_at,last_used_at) ON rcat_private.auth_sessions TO rcat_auth;

COMMENT ON ROLE rcat_auth IS 'Restricted authentication SQL role, separate from tenant-scoped app access';
COMMENT ON TABLE rcat_private.auth_sessions IS
  'Only SHA-256 digests of cryptographically random opaque session/CSRF tokens; no raw tokens in storage';
