-- QR ordering switch: stable printed QR, no staff PIN. New stores start closed.
-- Existing Order tracking remains independent of future open/closed changes.
ALTER TABLE rcat.stores ADD COLUMN ordering_enabled boolean NOT NULL DEFAULT false;

CREATE FUNCTION rcat_private.set_store_ordering_enabled(
 p_digest bytea,p_tenant uuid,p_store uuid,p_enabled boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_before boolean;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_digest,p_tenant,p_store,true);
 IF p_enabled IS NULL THEN
   RAISE EXCEPTION 'Invalid ordering state' USING ERRCODE='22023';
 END IF;
 SELECT ordering_enabled INTO v_before FROM rcat.stores
 WHERE tenant_id=p_tenant AND id=p_store FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Store unavailable' USING ERRCODE='42501';
 END IF;
 IF v_before IS DISTINCT FROM p_enabled THEN
   UPDATE rcat.stores SET ordering_enabled=p_enabled
   WHERE tenant_id=p_tenant AND id=p_store;
   INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
   VALUES(p_tenant,v_actor,'store.ordering.toggled',p_store,
     jsonb_build_object('previous',v_before,'next',p_enabled));
 END IF;
 RETURN p_enabled;
END $$;

-- Preserve the existing printable QR URLs and table listing contract.
CREATE OR REPLACE FUNCTION rcat_private.list_printable_tables(
 p_digest bytea,p_tenant uuid,p_store uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
 PERFORM rcat_private._catalog_actor(p_digest,p_tenant,p_store,false);
 RETURN jsonb_build_object(
 'orderingEnabled',(
   SELECT s.ordering_enabled FROM rcat.stores s
   WHERE s.tenant_id=p_tenant AND s.id=p_store
 ),
 'tables',COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'tableId',t.id,'label',t.label,'active',t.active,
     'codeExpiresAt',v.expires_at) ORDER BY t.label,t.id)
   FROM rcat.store_tables t
   LEFT JOIN rcat.table_ordering_visits v
     ON v.table_id=t.id AND v.tenant_id=t.tenant_id
      AND v.store_id=t.store_id AND v.revoked_at IS NULL
      AND v.code_digest IS NOT NULL AND v.expires_at>now()
   WHERE t.tenant_id=p_tenant AND t.store_id=p_store
 ),'[]'::jsonb));
END $$;

-- A static QR identifies the table only. A fresh opaque guest capability is
-- issued server-side on scan, never placed inside the printed URL.
-- Lock store before the table: a concurrent store close is atomic with grants.
CREATE FUNCTION rcat_private.open_printed_ordering_table(
 p_tenant uuid,p_store uuid,p_table uuid,p_master_digest bytea,p_guest_digest bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_open boolean;v_name text;v_label text;
 v_visit uuid;v_expires timestamptz;v_grants integer;
BEGIN
 IF p_tenant IS NULL OR p_store IS NULL OR p_table IS NULL
   OR p_master_digest IS NULL OR octet_length(p_master_digest)<>32
   OR p_guest_digest IS NULL OR octet_length(p_guest_digest)<>32
   OR p_master_digest=p_guest_digest THEN
   RAISE EXCEPTION 'Table unavailable' USING ERRCODE='42501';
 END IF;
 SELECT s.ordering_enabled,s.display_name INTO v_open,v_name
 FROM rcat.stores s WHERE s.tenant_id=p_tenant AND s.id=p_store
 FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Table unavailable' USING ERRCODE='42501';
 END IF;
 SELECT t.label INTO v_label FROM rcat.store_tables t
 WHERE t.tenant_id=p_tenant AND t.store_id=p_store
   AND t.id=p_table AND t.active FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Table unavailable' USING ERRCODE='42501';
 END IF;
 IF NOT v_open THEN
   RETURN jsonb_build_object(
     'open',false,'storeName',v_name,'tableLabel',v_label);
 END IF;

 SELECT v.id,v.expires_at INTO v_visit,v_expires
 FROM rcat.table_ordering_visits v
 WHERE v.tenant_id=p_tenant AND v.store_id=p_store
   AND v.table_id=p_table AND v.revoked_at IS NULL
   AND v.expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN
   UPDATE rcat.table_ordering_visits SET revoked_at=clock_timestamp()
   WHERE tenant_id=p_tenant AND store_id=p_store AND table_id=p_table
     AND revoked_at IS NULL;
   INSERT INTO rcat.table_ordering_visits(
     tenant_id,store_id,table_id,token_digest,expires_at
   ) VALUES(
     p_tenant,p_store,p_table,p_master_digest,clock_timestamp()+interval '6 hours'
   ) RETURNING id,expires_at INTO v_visit,v_expires;
 END IF;

 SELECT count(*) INTO v_grants FROM rcat.table_guest_grants
 WHERE visit_id=v_visit;
 IF v_grants>=200 THEN
   RAISE EXCEPTION 'Table guest grant limit' USING ERRCODE='P0041';
 END IF;
 INSERT INTO rcat.table_guest_grants(visit_id,token_digest,expires_at)
 VALUES(v_visit,p_guest_digest,v_expires);
 RETURN jsonb_build_object(
   'open',true,'storeName',v_name,'tableLabel',v_label,
   'expiresAt',v_expires);
END $$;

-- Protect the authoritative checkout transaction, not just the UI.
-- Store FOR SHARE blocks a concurrent close until submission commits.
CREATE FUNCTION rcat_private.place_guest_order_when_open(
 p_visit_digest bytea,p_idempotency_key text,p_cart jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_open boolean;
BEGIN
 SELECT s.ordering_enabled INTO v_open
 FROM rcat.stores s
 JOIN rcat.table_ordering_visits v ON v.tenant_id=s.tenant_id AND v.store_id=s.id
 JOIN rcat.store_tables t ON t.id=v.table_id
   AND t.tenant_id=v.tenant_id AND t.store_id=v.store_id
 WHERE (v.token_digest=p_visit_digest OR EXISTS(
   SELECT 1 FROM rcat.table_guest_grants g
   WHERE g.visit_id=v.id AND g.token_digest=p_visit_digest
     AND g.expires_at>now()
 )) AND v.revoked_at IS NULL AND v.expires_at>now()
   AND t.active FOR SHARE OF s;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501';
 END IF;
 IF NOT v_open THEN
   RAISE EXCEPTION 'Ordering closed' USING ERRCODE='P0040';
 END IF;
 RETURN rcat_private.place_guest_order(p_visit_digest,p_idempotency_key,p_cart);
END $$;

REVOKE ALL ON FUNCTION rcat_private.set_store_ordering_enabled(bytea,uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.open_printed_ordering_table(uuid,uuid,uuid,bytea,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.place_guest_order_when_open(bytea,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.set_store_ordering_enabled(bytea,uuid,uuid,boolean) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.open_printed_ordering_table(uuid,uuid,uuid,bytea,bytea) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.place_guest_order_when_open(bytea,text,jsonb) TO rcat_auth;
REVOKE EXECUTE ON FUNCTION rcat_private.place_guest_order(bytea,text,jsonb) FROM rcat_auth;
