-- G3: discover only merchant stores belonging to authenticated staff.
-- Includes kitchen role, which can read orders but not general store settings.
CREATE FUNCTION rcat_private.merchant_store_scopes(
  p_session_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid; v_stores jsonb;
BEGIN
  v_actor:=rcat_private._require_session_actor(p_session_digest);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'tenantId',s.tenant_id,'storeId',s.id,
    'tenantName',t.display_name,'storeName',s.display_name,
    'role',s.role
  ) ORDER BY t.slug,s.slug),'[]'::jsonb)
  INTO v_stores
  FROM (
    SELECT m.tenant_id,m.role,st.id,st.display_name,st.slug
    FROM rcat.tenant_memberships m
    JOIN rcat.stores st ON st.tenant_id=m.tenant_id
    WHERE m.user_id=v_actor
      AND m.role IN ('owner','manager','cashier','kitchen')
    ORDER BY m.tenant_id,st.slug LIMIT 100
  ) s
  JOIN rcat.tenants t ON t.id=s.tenant_id;
  RETURN jsonb_build_object('stores',v_stores);
END $$;
REVOKE ALL ON FUNCTION rcat_private.merchant_store_scopes(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_store_scopes(bytea) TO rcat_auth;
