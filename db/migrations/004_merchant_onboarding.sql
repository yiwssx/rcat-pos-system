-- G1: development-only merchant onboarding and staff invitations.
-- Only audited SECURITY DEFINER functions may create tenants or memberships.
-- Migration owner must be a reviewed privileged DB owner; no public EXECUTE.
CREATE TABLE rcat_private.merchant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES rcat.tenants(id) ON DELETE RESTRICT,
  invited_email text NOT NULL CHECK (
    invited_email=lower(trim(invited_email)) AND length(invited_email) BETWEEN 3 AND 254
  ),
  role text NOT NULL CHECK (role IN ('manager','cashier','kitchen')),
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest)=32),
  created_by uuid NOT NULL REFERENCES rcat.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES rcat.users(id),
  CHECK (expires_at>created_at),
  CHECK ((accepted_at IS NULL)=(accepted_by IS NULL))
);
CREATE INDEX merchant_invites_tenant_idx ON rcat_private.merchant_invitations(tenant_id,created_at DESC);

CREATE FUNCTION rcat_private._require_session_actor(p_session_digest bytea)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_actor uuid;
BEGIN
  IF p_session_digest IS NULL OR octet_length(p_session_digest)<>32 THEN
    RAISE EXCEPTION 'Session required' USING ERRCODE='28000';
  END IF;
  SELECT u.id INTO v_actor
  FROM rcat_private.auth_sessions s
  JOIN rcat.users u ON u.id=s.user_id
  WHERE s.token_digest=p_session_digest
    AND s.revoked_at IS NULL AND s.expires_at>now() AND u.is_active
  FOR UPDATE OF u;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Session required' USING ERRCODE='28000';
  END IF;
  RETURN v_actor;
END $$;

CREATE FUNCTION rcat_private.create_merchant_for_session(
  p_session_digest bytea,
  p_tenant_slug text,
  p_tenant_name text,
  p_store_slug text,
  p_store_name text
) RETURNS TABLE(tenant_id uuid,store_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_actor uuid; v_tenant uuid; v_store uuid;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_session_digest);
  IF p_tenant_slug IS NULL OR p_tenant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR length(p_tenant_slug) NOT BETWEEN 3 AND 48
    OR p_store_slug IS NULL OR p_store_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR length(p_store_slug) NOT BETWEEN 3 AND 48
    OR p_tenant_name IS NULL OR length(trim(p_tenant_name)) NOT BETWEEN 1 AND 160
    OR p_store_name IS NULL OR length(trim(p_store_name)) NOT BETWEEN 1 AND 160
  THEN RAISE EXCEPTION 'Invalid merchant details' USING ERRCODE='22023';
  END IF;
  -- Actor row is locked by _require_session_actor: concurrent requests from
  -- the same user cannot circumvent this development onboarding quota.
  IF (SELECT count(*) FROM rcat.tenant_memberships m
      WHERE m.user_id=v_actor AND m.role='owner')>=5 THEN
    RAISE EXCEPTION 'Store owner quota exceeded' USING ERRCODE='22023';
  END IF;
  INSERT INTO rcat.tenants(slug,display_name)
  VALUES(p_tenant_slug,trim(p_tenant_name)) RETURNING id INTO v_tenant;
  INSERT INTO rcat.stores(tenant_id,slug,display_name)
  VALUES(v_tenant,p_store_slug,trim(p_store_name)) RETURNING id INTO v_store;
  INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
  VALUES(v_tenant,v_actor,'owner');
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id)
  VALUES(v_tenant,v_actor,'tenant.created',v_store);
  RETURN QUERY SELECT v_tenant,v_store;
END $$;

CREATE FUNCTION rcat_private.create_staff_invitation(
  p_session_digest bytea, p_tenant_id uuid, p_email text,
  p_role text, p_token_digest bytea
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_actor uuid; v_id uuid; v_email text;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_session_digest);
  v_email:=lower(trim(p_email));
  IF p_tenant_id IS NULL OR v_email IS NULL
    OR length(v_email) NOT BETWEEN 3 AND 254
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    OR p_role IS NULL OR p_role NOT IN ('manager','cashier','kitchen')
    OR p_token_digest IS NULL OR octet_length(p_token_digest)<>32
  THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM rcat.tenants t WHERE t.id=p_tenant_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(
    SELECT 1 FROM rcat.tenant_memberships m
    WHERE m.user_id=v_actor AND m.tenant_id=p_tenant_id AND m.role='owner'
  ) THEN RAISE EXCEPTION 'Tenant unavailable' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM rcat_private.merchant_invitations i
      WHERE i.tenant_id=p_tenant_id AND i.accepted_at IS NULL
        AND i.expires_at>now())>=20 THEN
    RAISE EXCEPTION 'Too many pending invitations' USING ERRCODE='22023';
  END IF;
  INSERT INTO rcat_private.merchant_invitations
    (tenant_id,invited_email,role,token_digest,created_by,expires_at)
  VALUES(p_tenant_id,v_email,p_role,p_token_digest,v_actor,now()+interval '72 hours')
  RETURNING id INTO v_id;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id)
  VALUES(p_tenant_id,v_actor,'staff.invited',v_id);
  RETURN v_id;
END $$;

CREATE FUNCTION rcat_private.accept_staff_invitation(
  p_session_digest bytea, p_token_digest bytea
) RETURNS TABLE(tenant_id uuid,role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_actor uuid; v_email text; v_inv rcat_private.merchant_invitations%ROWTYPE;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_session_digest);
  IF p_token_digest IS NULL OR octet_length(p_token_digest)<>32 THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT u.email INTO v_email FROM rcat.users u WHERE u.id=v_actor AND u.is_active;
  SELECT i.* INTO v_inv FROM rcat_private.merchant_invitations i
    WHERE i.token_digest=p_token_digest FOR UPDATE;
  IF NOT FOUND OR v_inv.accepted_at IS NOT NULL OR v_inv.expires_at<=now()
    OR v_inv.invited_email IS DISTINCT FROM v_email
  THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  -- Existing membership cannot be overwritten or elevated by an invitation.
  IF EXISTS(SELECT 1 FROM rcat.tenant_memberships m
    WHERE m.tenant_id=v_inv.tenant_id AND m.user_id=v_actor)
  THEN RAISE EXCEPTION 'Already a member' USING ERRCODE='23505'; END IF;
  INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
  VALUES(v_inv.tenant_id,v_actor,v_inv.role);
  UPDATE rcat_private.merchant_invitations
  SET accepted_at=now(),accepted_by=v_actor WHERE id=v_inv.id;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id)
  VALUES(v_inv.tenant_id,v_actor,'staff.invitation.accepted',v_inv.id);
  RETURN QUERY SELECT v_inv.tenant_id,v_inv.role;
END $$;

REVOKE ALL ON FUNCTION rcat_private._require_session_actor(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.create_merchant_for_session(bytea,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.create_staff_invitation(bytea,uuid,text,text,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.accept_staff_invitation(bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.create_merchant_for_session(bytea,text,text,text,text) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.create_staff_invitation(bytea,uuid,text,text,bytea) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.accept_staff_invitation(bytea,bytea) TO rcat_auth;
-- SQL table privileges remain absent: only the reviewed functions write records.
