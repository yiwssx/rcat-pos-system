-- RCAT POS closed Google Workspace platform access (owner-approved, 17 Nov 2026).
-- Platform roles and tenant/store memberships are deliberately independent.
-- Only a verified Google login for admin@rcat.ac.th may bootstrap Super Admin.
-- Runtime roles never get direct INSERT/UPDATE/DELETE on platform accounts.
CREATE TABLE rcat_private.platform_accounts (
  user_id uuid PRIMARY KEY REFERENCES rcat.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('super_admin','admin','merchant')),
  granted_by uuid REFERENCES rcat.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_single_super_admin
  ON rcat_private.platform_accounts(role) WHERE role='super_admin';
REVOKE ALL ON rcat_private.platform_accounts FROM PUBLIC,rcat_auth,rcat_app;

CREATE TABLE rcat_private.platform_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES rcat.users(id) ON DELETE SET NULL,
  subject_id uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('bootstrap','grant','suspend','assign_merchant','super_enter_tenant')),
  previous_role text,
  next_role text,
  tenant_id uuid REFERENCES rcat.tenants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON rcat_private.platform_access_audit FROM PUBLIC,rcat_auth,rcat_app;

-- Exact Google-sub binding and anti-recycling protections from migration 020 remain.
-- No auto-provisioning for any email other than the fixed Super Admin identity.
CREATE OR REPLACE FUNCTION rcat_private.issue_google_workspace_session(
  p_email text,p_google_sub text,p_session_digest bytea,p_csrf_digest bytea
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_user uuid;v_sub text;v_owner uuid;v_role text;
BEGIN
  IF p_email IS NULL OR p_email<>lower(trim(p_email))
    OR p_email !~ '^[^[:space:]@]+@rcat[.]ac[.]th$'
    OR length(p_email)>254 OR p_google_sub IS NULL
    OR p_google_sub !~ '^[A-Za-z0-9_-]+$'
    OR length(p_google_sub) NOT BETWEEN 1 AND 255
    OR p_session_digest IS NULL OR octet_length(p_session_digest)<>32
    OR p_csrf_digest IS NULL OR octet_length(p_csrf_digest)<>32
  THEN RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='22023';
  END IF;

  IF p_email='admin@rcat.ac.th' THEN
    -- This code is reached only after the API has verified signature, aud,
    -- nonce, email_verified and the signed hd=rcat.ac.th Google claims.
    INSERT INTO rcat.users(email,password_hash,is_active)
    VALUES('admin@rcat.ac.th','GOOGLE_OAUTH_ONLY_NO_PASSWORD',true)
    ON CONFLICT(email) DO NOTHING;
    SELECT id INTO v_user FROM rcat.users
      WHERE email='admin@rcat.ac.th' AND is_active FOR UPDATE;
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
    END IF;
    INSERT INTO rcat_private.platform_accounts(user_id,role)
    VALUES(v_user,'super_admin') ON CONFLICT(user_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM rcat_private.platform_access_audit
                   WHERE subject_id=v_user AND action='bootstrap') THEN
      INSERT INTO rcat_private.platform_access_audit(subject_id,action,next_role)
      VALUES(v_user,'bootstrap','super_admin');
    END IF;
  ELSE
    SELECT u.id INTO v_user FROM rcat.users u
      JOIN rcat_private.platform_accounts p ON p.user_id=u.id
      WHERE u.email=p_email AND u.is_active AND p.role IN ('admin','merchant')
      FOR UPDATE OF u;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;
  SELECT p.role INTO v_role FROM rcat_private.platform_accounts p
   WHERE p.user_id=v_user FOR UPDATE;
  IF v_role IS NULL OR
     (p_email='admin@rcat.ac.th' AND v_role<>'super_admin') THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;
  SELECT g.google_sub INTO v_sub FROM rcat_private.google_identities g
   WHERE g.user_id=v_user FOR UPDATE;
  IF v_sub IS NOT NULL AND v_sub<>p_google_sub THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;
  SELECT g.user_id INTO v_owner FROM rcat_private.google_identities g
   WHERE g.google_sub=p_google_sub FOR UPDATE;
  IF v_owner IS NOT NULL AND v_owner<>v_user THEN
    RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='42501';
  END IF;
  IF v_sub IS NULL THEN
    INSERT INTO rcat_private.google_identities(user_id,google_sub,email)
    VALUES(v_user,p_google_sub,p_email);
  END IF;
  INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
  VALUES(v_user,p_session_digest,p_csrf_digest,now()+interval '12 hours');
  RETURN v_user;
END $$;

CREATE FUNCTION rcat_private.platform_role_for_user(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $$
  SELECT p.role FROM rcat_private.platform_accounts p
  JOIN rcat.users u ON u.id=p.user_id
  WHERE p.user_id=p_user AND u.is_active
$$;
REVOKE ALL ON FUNCTION rcat_private.platform_role_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.platform_role_for_user(uuid) TO rcat_auth;

-- Only signed-in platform Admin/Super Admin may view the manually allowed roster.
CREATE FUNCTION rcat_private.list_platform_accounts(p_digest bytea)
RETURNS TABLE(user_id uuid,email text,role text,is_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_digest);
  SELECT p.role INTO v_role FROM rcat_private.platform_accounts p WHERE p.user_id=v_actor;
  IF v_role NOT IN ('super_admin','admin') OR v_role IS NULL THEN
    RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT u.id,u.email,p.role,u.is_active
    FROM rcat_private.platform_accounts p JOIN rcat.users u ON u.id=p.user_id
    ORDER BY CASE p.role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      u.email LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION rcat_private.list_platform_accounts(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.list_platform_accounts(bytea) TO rcat_auth;

-- Manual allowlist grant/change/suspend, with role hierarchy and session revocation.
CREATE FUNCTION rcat_private.manage_platform_account(
 p_digest bytea,p_email text,p_role text,p_active boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_actor_role text;v_user uuid;v_before text;v_old_active boolean;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_digest);
  SELECT role INTO v_actor_role FROM rcat_private.platform_accounts
    WHERE user_id=v_actor FOR UPDATE;
  IF v_actor_role NOT IN ('super_admin','admin') OR v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';
  END IF;
  IF p_email IS NULL OR p_email<>lower(trim(p_email))
    OR p_email !~ '^[^[:space:]@]+@rcat[.]ac[.]th$'
    OR length(p_email)>254 OR p_email='admin@rcat.ac.th'
    OR p_role NOT IN ('admin','merchant') OR p_role IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'Invalid access request' USING ERRCODE='22023';
  END IF;
  IF p_role='admin' AND v_actor_role<>'super_admin' THEN
    RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';
  END IF;
  INSERT INTO rcat.users(email,password_hash,is_active)
  VALUES(p_email,'GOOGLE_OAUTH_ONLY_NO_PASSWORD',p_active)
  ON CONFLICT(email) DO NOTHING;
  SELECT u.id,u.is_active INTO v_user,v_old_active FROM rcat.users u
    WHERE u.email=p_email FOR UPDATE;
  SELECT role INTO v_before FROM rcat_private.platform_accounts
    WHERE user_id=v_user FOR UPDATE;
  IF v_before='super_admin' OR
     (v_before='admin' AND v_actor_role<>'super_admin') THEN
    RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';
  END IF;
  INSERT INTO rcat_private.platform_accounts(user_id,role,granted_by)
  VALUES(v_user,p_role,v_actor)
  ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role,
    granted_by=EXCLUDED.granted_by,changed_at=now();
  UPDATE rcat.users SET is_active=p_active WHERE id=v_user;
  IF NOT p_active OR v_before IS DISTINCT FROM p_role OR v_old_active IS DISTINCT FROM p_active THEN
    UPDATE rcat_private.auth_sessions SET revoked_at=now()
      WHERE user_id=v_user AND revoked_at IS NULL;
  END IF;
  INSERT INTO rcat_private.platform_access_audit(actor_id,subject_id,action,previous_role,next_role)
  VALUES(v_actor,v_user,CASE WHEN p_active THEN 'grant' ELSE 'suspend' END,v_before,p_role);
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION rcat_private.manage_platform_account(bytea,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.manage_platform_account(bytea,text,text,boolean) TO rcat_auth;

CREATE FUNCTION rcat_private.list_platform_tenants(p_digest bytea)
RETURNS TABLE(tenant_id uuid,tenant_name text,store_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_digest);
  SELECT p.role INTO v_role FROM rcat_private.platform_accounts p WHERE p.user_id=v_actor;
  IF v_role NOT IN ('super_admin','admin') OR v_role IS NULL THEN
    RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT t.id,t.display_name,count(s.id)
  FROM rcat.tenants t LEFT JOIN rcat.stores s ON s.tenant_id=t.id
  GROUP BY t.id,t.display_name,t.slug ORDER BY t.slug LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION rcat_private.list_platform_tenants(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.list_platform_tenants(bytea) TO rcat_auth;

-- Super/Admin assigns an already approved Merchant to an existing tenant.
-- Merchant's effective shop permissions remain governed by tenant RLS.
CREATE FUNCTION rcat_private.assign_platform_merchant(
 p_digest bytea,p_email text,p_tenant uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_actor_role text;v_user uuid;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_digest);
  SELECT role INTO v_actor_role FROM rcat_private.platform_accounts WHERE user_id=v_actor;
  IF v_actor_role NOT IN ('super_admin','admin') OR v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';
  END IF;
  IF p_email IS NULL OR p_email<>lower(trim(p_email)) OR
     p_email !~ '^[^[:space:]@]+@rcat[.]ac[.]th$' OR p_tenant IS NULL THEN
    RAISE EXCEPTION 'Invalid merchant assignment' USING ERRCODE='22023';
  END IF;
  SELECT u.id INTO v_user FROM rcat.users u
  JOIN rcat_private.platform_accounts p ON p.user_id=u.id
  WHERE u.email=p_email AND u.is_active AND p.role='merchant' FOR UPDATE OF u;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Merchant unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM rcat.tenants WHERE id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
  VALUES(p_tenant,v_user,'owner')
  ON CONFLICT(tenant_id,user_id) DO UPDATE SET role='owner';
  INSERT INTO rcat_private.platform_access_audit(actor_id,subject_id,action,tenant_id)
  VALUES(v_actor,v_user,'assign_merchant',p_tenant);
  RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION rcat_private.assign_platform_merchant(bytea,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.assign_platform_merchant(bytea,text,uuid) TO rcat_auth;

-- Super Admin can explicitly and audibly take Owner access to any tenant;
-- no global RLS bypass or synthetic role injected from the client.
CREATE FUNCTION rcat_private.super_admin_enter_tenant(p_digest bytea,p_tenant uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_role text;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_digest);
  SELECT role INTO v_role FROM rcat_private.platform_accounts WHERE user_id=v_actor;
  IF v_role IS DISTINCT FROM 'super_admin' OR p_tenant IS NULL THEN
    RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM rcat.tenants WHERE id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
  VALUES(p_tenant,v_actor,'owner')
  ON CONFLICT(tenant_id,user_id) DO UPDATE SET role='owner';
  INSERT INTO rcat_private.platform_access_audit(actor_id,subject_id,action,tenant_id)
  VALUES(v_actor,v_actor,'super_enter_tenant',p_tenant);
  RETURN v_actor;
END $$;
REVOKE ALL ON FUNCTION rcat_private.super_admin_enter_tenant(bytea,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.super_admin_enter_tenant(bytea,uuid) TO rcat_auth;
