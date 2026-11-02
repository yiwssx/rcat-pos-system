-- Owner-only staff roster, role changes and revocation.
-- Keep privileged writes inside audited functions, not direct table grants.
CREATE FUNCTION rcat_private._require_tenant_owner(
  p_session_digest bytea, p_tenant_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor := rcat_private._require_session_actor(p_session_digest);
  -- Serialize administrative mutations for the same tenant.
  PERFORM 1 FROM rcat.tenants t WHERE t.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM rcat.tenant_memberships m
      WHERE m.tenant_id = p_tenant_id
        AND m.user_id = v_actor AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Tenant unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END $$;

CREATE FUNCTION rcat_private.list_tenant_staff(
  p_session_digest bytea, p_tenant_id uuid
) RETURNS TABLE(user_id uuid, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM rcat_private._require_tenant_owner(p_session_digest,p_tenant_id);
  RETURN QUERY
    SELECT m.user_id,m.role
      FROM rcat.tenant_memberships m
     WHERE m.tenant_id=p_tenant_id
     ORDER BY m.created_at,m.user_id;
END $$;

CREATE FUNCTION rcat_private.manage_tenant_staff(
  p_session_digest bytea, p_tenant_id uuid, p_user_id uuid,
  p_action text, p_new_role text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_actor uuid; v_old_role text;
BEGIN
  v_actor := rcat_private._require_tenant_owner(p_session_digest,p_tenant_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Staff unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT m.role INTO v_old_role
    FROM rcat.tenant_memberships m
   WHERE m.tenant_id=p_tenant_id AND m.user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_old_role='owner' THEN
    -- Owner transfer/deletion requires a separate verified recovery procedure.
    RAISE EXCEPTION 'Staff unavailable' USING ERRCODE = '42501';
  END IF;

  IF p_action='change_role' THEN
    IF p_new_role IS NULL
      OR p_new_role NOT IN ('manager','cashier','kitchen')
    THEN RAISE EXCEPTION 'Invalid staff role' USING ERRCODE='22023';
    END IF;
    IF p_new_role=v_old_role THEN
      RETURN v_old_role;
    END IF;
    UPDATE rcat.tenant_memberships
       SET role=p_new_role
     WHERE tenant_id=p_tenant_id AND user_id=p_user_id;
    INSERT INTO rcat.audit_events
      (tenant_id,actor_user_id,action,subject_id,metadata)
      VALUES (p_tenant_id,v_actor,'staff.role.changed',p_user_id,
        jsonb_build_object('previous',v_old_role,'next',p_new_role));
    RETURN p_new_role;
  ELSIF p_action='remove' THEN
    DELETE FROM rcat.tenant_memberships
      WHERE tenant_id=p_tenant_id AND user_id=p_user_id;
    INSERT INTO rcat.audit_events
      (tenant_id,actor_user_id,action,subject_id,metadata)
      VALUES (p_tenant_id,v_actor,'staff.removed',p_user_id,
        jsonb_build_object('previous',v_old_role));
    RETURN 'removed';
  ELSE
    RAISE EXCEPTION 'Invalid staff action' USING ERRCODE='22023';
  END IF;
END $$;

REVOKE ALL ON FUNCTION rcat_private._require_tenant_owner(bytea,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.list_tenant_staff(bytea,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.manage_tenant_staff(bytea,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.list_tenant_staff(bytea,uuid) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.manage_tenant_staff(bytea,uuid,uuid,text,text) TO rcat_auth;
