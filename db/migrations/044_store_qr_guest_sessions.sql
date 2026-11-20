-- Issue #102 / Service Mode B2: store QR entry is public, guest session is not.
-- No Store QR session may be used through the legacy Table Visit checkout API.
-- B3 Bill closure and C Quick Order writes are separate, intentionally gated.
CREATE TABLE rcat_private.store_public_qrs (
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  generation bigint NOT NULL DEFAULT 1 CHECK(generation BETWEEN 1 AND 9223372036854775806),
  changed_by uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,store_id),
  UNIQUE(public_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES rcat.stores(tenant_id,id)
    ON DELETE RESTRICT
);

-- Every scan creates its OWN 256-bit possession capability. Public QR IDs
-- never authorize another person's session, cart or Order.
CREATE TABLE rcat_private.store_guest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  qr_generation bigint NOT NULL CHECK(qr_generation>0),
  mode_revision bigint NOT NULL CHECK(mode_revision>0),
  token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY(tenant_id,store_id) REFERENCES rcat.stores(tenant_id,id)
    ON DELETE RESTRICT,
  CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '6 hours')
);
CREATE INDEX store_guest_sessions_scope_idx
  ON rcat_private.store_guest_sessions(tenant_id,store_id,expires_at)
  WHERE revoked_at IS NULL;
REVOKE ALL ON rcat_private.store_public_qrs FROM PUBLIC,rcat_app,rcat_auth;
REVOKE ALL ON rcat_private.store_guest_sessions FROM PUBLIC,rcat_app,rcat_auth;

-- Existing _catalog_actor enforces tenant, store and role.
-- Read-only staff may print the public QR; only owner/manager may rotate it.
CREATE FUNCTION rcat_private.store_qr_snapshot(
  p_digest bytea,p_tenant uuid,p_store uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_id uuid;v_mode text;v_enabled boolean;
BEGIN
  PERFORM rcat_private._catalog_actor(p_digest,p_tenant,p_store,false);
  SELECT q.public_id INTO v_id FROM rcat_private.store_public_qrs q
    WHERE q.tenant_id=p_tenant AND q.store_id=p_store;
  SELECT coalesce(m.service_mode,'table'),s.ordering_enabled INTO v_mode,v_enabled
  FROM rcat.stores s LEFT JOIN rcat_private.store_service_modes m
    ON m.tenant_id=s.tenant_id AND m.store_id=s.id
  WHERE s.tenant_id=p_tenant AND s.id=p_store;
  RETURN jsonb_build_object(
    'publicId',v_id,'serviceMode',v_mode,'orderingEnabled',v_enabled
  );
END $$;

-- Lock store before QR and grant rows. Rotating revokes *all* old grants
-- atomically, without changing Table QR or minting a financial credential.
CREATE FUNCTION rcat_private.rotate_store_qr(
  p_digest bytea,p_tenant uuid,p_store uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_mode text;v_id uuid;v_generation bigint;
BEGIN
  v_actor:=rcat_private._catalog_actor(p_digest,p_tenant,p_store,true);
  PERFORM 1 FROM rcat.stores s
   WHERE s.tenant_id=p_tenant AND s.id=p_store FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store unavailable' USING ERRCODE='42501';
  END IF;
  SELECT m.service_mode INTO v_mode
  FROM rcat_private.store_service_modes m
  WHERE m.tenant_id=p_tenant AND m.store_id=p_store;
  IF v_mode IS NULL OR v_mode NOT IN ('quick','hybrid') THEN
    RAISE EXCEPTION 'Store QR mode unavailable' USING ERRCODE='42501';
  END IF;

  INSERT INTO rcat_private.store_public_qrs(
    tenant_id,store_id,public_id,generation,changed_by
  ) VALUES(p_tenant,p_store,gen_random_uuid(),1,v_actor)
  ON CONFLICT(tenant_id,store_id) DO UPDATE SET
    public_id=gen_random_uuid(),
    generation=rcat_private.store_public_qrs.generation+1,
    changed_by=EXCLUDED.changed_by,
    changed_at=clock_timestamp()
  RETURNING public_id,generation INTO v_id,v_generation;

  UPDATE rcat_private.store_guest_sessions
  SET revoked_at=clock_timestamp()
  WHERE tenant_id=p_tenant AND store_id=p_store AND revoked_at IS NULL;

  INSERT INTO rcat.audit_events(
    tenant_id,actor_user_id,action,subject_id,metadata
  ) VALUES(
    p_tenant,v_actor,'store.qr.rotated',p_store,
    jsonb_build_object('generation',v_generation)
  );
  RETURN jsonb_build_object('publicId',v_id,'generation',v_generation);
END $$;

-- Public Store QR is only a locator. A fresh opaque token is supplied by
-- the trusted API, stored only as its digest, and never appears in QR URL.
-- Require configured Quick/Hybrid, enabled ordering and current QR version.
CREATE FUNCTION rcat_private.open_printed_store_qr(
  p_tenant uuid,p_store uuid,p_public_id uuid,p_token_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_open boolean;v_name text;v_mode text;v_mode_revision bigint;
  v_generation bigint;v_count integer;v_session uuid;v_expires timestamptz;
BEGIN
  IF p_tenant IS NULL OR p_store IS NULL OR p_public_id IS NULL
    OR p_token_digest IS NULL OR octet_length(p_token_digest)<>32 THEN
    RAISE EXCEPTION 'Store QR unavailable' USING ERRCODE='42501';
  END IF;

  -- Store ordering toggle, mode changes, QR rotation and guest grant creation
  -- serialize via this same parent row lock across API replicas.
  SELECT s.ordering_enabled,s.display_name INTO v_open,v_name
  FROM rcat.stores s WHERE s.tenant_id=p_tenant AND s.id=p_store
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store QR unavailable' USING ERRCODE='42501';
  END IF;
  SELECT m.service_mode,m.revision INTO v_mode,v_mode_revision
  FROM rcat_private.store_service_modes m
  WHERE m.tenant_id=p_tenant AND m.store_id=p_store;
  IF v_mode IS NULL OR v_mode NOT IN ('quick','hybrid') THEN
    RAISE EXCEPTION 'Store QR unavailable' USING ERRCODE='42501';
  END IF;
  SELECT q.generation INTO v_generation FROM rcat_private.store_public_qrs q
  WHERE q.tenant_id=p_tenant AND q.store_id=p_store
    AND q.public_id=p_public_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store QR unavailable' USING ERRCODE='42501';
  END IF;
  IF NOT v_open THEN
    RETURN jsonb_build_object('open',false,'storeName',v_name);
  END IF;

  SELECT count(*) INTO v_count
  FROM rcat_private.store_guest_sessions g
  WHERE g.tenant_id=p_tenant AND g.store_id=p_store
    AND g.qr_generation=v_generation
    AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp();
  IF v_count>=500 THEN
    RAISE EXCEPTION 'Too many Store QR sessions' USING ERRCODE='P0041';
  END IF;

  INSERT INTO rcat_private.store_guest_sessions(
    tenant_id,store_id,qr_generation,mode_revision,token_digest,expires_at
  ) VALUES(
    p_tenant,p_store,v_generation,v_mode_revision,p_token_digest,
    clock_timestamp()+interval '6 hours'
  ) RETURNING id,expires_at INTO v_session,v_expires;
  RETURN jsonb_build_object(
    'open',true,'storeName',v_name,
    'serviceMode',v_mode,'guestSessionId',v_session,'expiresAt',v_expires
  );
END $$;

-- Only the holder of a *particular* Guest token can resolve that session.
-- Store QR public_id is never an authentication credential. Mode revision,
-- QR generation, expiry and store intake are rechecked on every read.
CREATE FUNCTION rcat_private.resolve_store_guest_session(
  p_token_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_session rcat_private.store_guest_sessions%ROWTYPE;
  v_name text;v_mode text;
BEGIN
  IF p_token_digest IS NULL OR octet_length(p_token_digest)<>32 THEN
    RAISE EXCEPTION 'Store session unavailable' USING ERRCODE='42501';
  END IF;
  SELECT g.* INTO v_session
  FROM rcat_private.store_guest_sessions g
  WHERE g.token_digest=p_token_digest AND g.revoked_at IS NULL
    AND g.expires_at>clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store session unavailable' USING ERRCODE='42501';
  END IF;
  SELECT s.display_name,m.service_mode INTO v_name,v_mode
  FROM rcat.stores s
  JOIN rcat_private.store_public_qrs q
    ON q.tenant_id=s.tenant_id AND q.store_id=s.id
  JOIN rcat_private.store_service_modes m
    ON m.tenant_id=s.tenant_id AND m.store_id=s.id
  WHERE s.tenant_id=v_session.tenant_id
    AND s.id=v_session.store_id AND s.ordering_enabled
    AND q.generation=v_session.qr_generation
    AND m.revision=v_session.mode_revision
    AND m.service_mode IN ('quick','hybrid')
  FOR SHARE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store session unavailable' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'guestSessionId',v_session.id,'tenantId',v_session.tenant_id,
    'storeId',v_session.store_id,'storeName',v_name,
    'serviceMode',v_mode,'entryMode','counter',
    'expiresAt',v_session.expires_at
  );
END $$;

-- When the owner closes ordering, all previous Store QR sessions are
-- revoked (not merely hidden). Reopening does not restore old clients.
CREATE FUNCTION rcat_private.revoke_store_guest_sessions_on_close()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  UPDATE rcat_private.store_guest_sessions
  SET revoked_at=clock_timestamp()
  WHERE tenant_id=NEW.tenant_id AND store_id=NEW.id AND revoked_at IS NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER store_guest_sessions_close_gate
AFTER UPDATE OF ordering_enabled ON rcat.stores
FOR EACH ROW WHEN (OLD.ordering_enabled AND NOT NEW.ordering_enabled)
EXECUTE FUNCTION rcat_private.revoke_store_guest_sessions_on_close();

REVOKE ALL ON FUNCTION rcat_private.store_qr_snapshot(bytea,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.rotate_store_qr(bytea,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.open_printed_store_qr(uuid,uuid,uuid,bytea)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.resolve_store_guest_session(bytea)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.revoke_store_guest_sessions_on_close()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.store_qr_snapshot(bytea,uuid,uuid)
  TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.rotate_store_qr(bytea,uuid,uuid)
  TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.open_printed_store_qr(uuid,uuid,uuid,bytea)
  TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.resolve_store_guest_session(bytea)
  TO rcat_auth;
