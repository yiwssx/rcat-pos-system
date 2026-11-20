-- G2/G3 #102 Service Mode B1: store-scoped, DORMANT configuration.
-- Existing stores remain Table Service; this migration does NOT activate
-- Store QR, Quick Service, Hybrid checkout, Bill closure or any Payment path.
-- A future guarded server migration must explicitly enforce the chosen mode.
CREATE TABLE rcat_private.store_service_modes (
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  service_mode text NOT NULL
    CHECK(service_mode IN ('table','quick','hybrid')),
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9223372036854775806),
  changed_by uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,store_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES rcat.stores(tenant_id,id)
    ON DELETE RESTRICT
);
-- Private configuration must never be directly readable or writable using
-- the legacy rcat_app store UPDATE grant, nor the auth connection role.
REVOKE ALL ON rcat_private.store_service_modes FROM PUBLIC,rcat_app,rcat_auth;

-- A missing row means the backward-compatible Table Service default,
-- not an already-enabled Quick/Hybrid ordering channel.
CREATE FUNCTION rcat_private.store_service_mode_snapshot(
  p_digest bytea,p_tenant uuid,p_store uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_mode text;v_revision bigint;
BEGIN
  PERFORM rcat_private._catalog_actor(p_digest,p_tenant,p_store,false);
  SELECT m.service_mode,m.revision INTO v_mode,v_revision
  FROM rcat_private.store_service_modes m
  WHERE m.tenant_id=p_tenant AND m.store_id=p_store;
  RETURN jsonb_build_object(
    'serviceMode',coalesce(v_mode,'table'),
    'revision',coalesce(v_revision,0),
    'configured',v_revision IS NOT NULL
  );
END $$;

-- Owner/Manager only. Serialize concurrent changes on the parent store,
-- then compare revisions before changing the private row or writing audit.
-- Stale writes use P0042; identical writes do not increment or double-audit.
CREATE FUNCTION rcat_private.set_store_service_mode(
  p_digest bytea,p_tenant uuid,p_store uuid,
  p_mode text,p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_before text;v_revision bigint;
BEGIN
  v_actor:=rcat_private._catalog_actor(p_digest,p_tenant,p_store,true);
  IF p_mode IS NULL OR p_mode NOT IN ('table','quick','hybrid')
    OR p_expected_revision IS NULL OR p_expected_revision<0
    OR p_expected_revision>=9223372036854775806
  THEN RAISE EXCEPTION 'Invalid service mode request' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM rcat.stores s
  WHERE s.tenant_id=p_tenant AND s.id=p_store FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store unavailable' USING ERRCODE='42501';
  END IF;
  SELECT m.service_mode,m.revision INTO v_before,v_revision
  FROM rcat_private.store_service_modes m
  WHERE m.tenant_id=p_tenant AND m.store_id=p_store FOR UPDATE;
  IF NOT FOUND THEN v_before:='table';v_revision:=0; END IF;

  IF v_revision<>p_expected_revision THEN
    RAISE EXCEPTION 'Service mode changed; refresh before updating'
      USING ERRCODE='P0042';
  END IF;
  IF v_before=p_mode THEN
    RETURN jsonb_build_object(
      'serviceMode',v_before,'revision',v_revision,'changed',false
    );
  END IF;

  INSERT INTO rcat_private.store_service_modes(
    tenant_id,store_id,service_mode,revision,changed_by,changed_at
  ) VALUES(
    p_tenant,p_store,p_mode,v_revision+1,v_actor,clock_timestamp()
  ) ON CONFLICT(tenant_id,store_id) DO UPDATE SET
    service_mode=EXCLUDED.service_mode,
    revision=EXCLUDED.revision,
    changed_by=EXCLUDED.changed_by,
    changed_at=EXCLUDED.changed_at;
  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata
  ) VALUES(
    p_tenant,v_actor,'store.service_mode.changed',p_store,
    jsonb_build_object(
      'previous',v_before,'next',p_mode,'revision',v_revision+1
    )
  );
  RETURN jsonb_build_object(
    'serviceMode',p_mode,'revision',v_revision+1,'changed',true
  );
END $$;

REVOKE ALL ON FUNCTION rcat_private.store_service_mode_snapshot(bytea,uuid,uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.set_store_service_mode(bytea,uuid,uuid,text,bigint)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.store_service_mode_snapshot(bytea,uuid,uuid)
  TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.set_store_service_mode(bytea,uuid,uuid,text,bigint)
  TO rcat_auth;
