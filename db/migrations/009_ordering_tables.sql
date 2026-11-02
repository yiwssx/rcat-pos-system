-- G2: per-visit ordering access; QR is for ORDERING, never PromptPay.
-- A fixed printed QR alone does not prove the current guest visit. A merchant
-- must display/distribute a newly rotated visit link or add a separate PIN flow.
CREATE TABLE rcat.store_tables (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 store_id uuid NOT NULL,
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 60),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,store_id,id),
 UNIQUE(tenant_id,store_id,label),
 FOREIGN KEY(tenant_id,store_id) REFERENCES rcat.stores(tenant_id,id)
  ON DELETE RESTRICT
);
CREATE INDEX store_tables_lookup_idx ON rcat.store_tables(tenant_id,store_id);

CREATE TABLE rcat.table_ordering_visits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 store_id uuid NOT NULL,
 table_id uuid NOT NULL,
 token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
 issued_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 FOREIGN KEY(tenant_id,store_id,table_id)
   REFERENCES rcat.store_tables(tenant_id,store_id,id) ON DELETE RESTRICT,
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '12 hours')
);
CREATE UNIQUE INDEX table_visit_one_current_idx
 ON rcat.table_ordering_visits(tenant_id,store_id,table_id)
 WHERE revoked_at IS NULL;
CREATE INDEX table_visits_expiry_idx
 ON rcat.table_ordering_visits(expires_at);

ALTER TABLE rcat.store_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.store_tables FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.table_ordering_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.table_ordering_visits FORCE ROW LEVEL SECURITY;
CREATE POLICY store_tables_tenant_read ON rcat.store_tables
 FOR SELECT TO rcat_app
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY visits_tenant_read ON rcat.table_ordering_visits
 FOR SELECT TO rcat_app
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT ON rcat.store_tables,rcat.table_ordering_visits TO rcat_app;

CREATE FUNCTION rcat_private.create_ordering_table(
 p_session_digest bytea,p_tenant_id uuid,p_store_id uuid,p_label text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_id uuid;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_session_digest,p_tenant_id,p_store_id,true);
 IF p_label IS NULL OR length(trim(p_label)) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Invalid table label' USING ERRCODE='22023';
 END IF;
 INSERT INTO rcat.store_tables(tenant_id,store_id,label)
 VALUES(p_tenant_id,p_store_id,trim(p_label)) RETURNING id INTO v_id;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id)
 VALUES(p_tenant_id,v_actor,'table.created',v_id);
 RETURN v_id;
END $$;

CREATE FUNCTION rcat_private.rotate_ordering_visit(
 p_session_digest bytea,p_tenant_id uuid,p_store_id uuid,
 p_table_id uuid,p_token_digest bytea
) RETURNS TABLE(visit_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_id uuid;v_expires timestamptz;
BEGIN
 v_actor:=rcat_private._catalog_actor(p_session_digest,p_tenant_id,p_store_id,true);
 IF p_token_digest IS NULL OR octet_length(p_token_digest)<>32 THEN
    RAISE EXCEPTION 'Invalid visit secret' USING ERRCODE='22023'; END IF;
 -- Serializes rotations for the SAME table, across all app instances.
 PERFORM 1 FROM rcat.store_tables t
 WHERE t.tenant_id=p_tenant_id AND t.store_id=p_store_id
   AND t.id=p_table_id AND t.active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Table unavailable' USING ERRCODE='42501'; END IF;
 UPDATE rcat.table_ordering_visits SET revoked_at=now()
 WHERE tenant_id=p_tenant_id AND store_id=p_store_id AND table_id=p_table_id
   AND revoked_at IS NULL;
 INSERT INTO rcat.table_ordering_visits(
   tenant_id,store_id,table_id,token_digest,expires_at
 ) VALUES(p_tenant_id,p_store_id,p_table_id,p_token_digest,now()+interval '6 hours')
 RETURNING id,table_ordering_visits.expires_at INTO v_id,v_expires;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id)
 VALUES(p_tenant_id,v_actor,'table.visit.rotated',v_id);
 RETURN QUERY SELECT v_id,v_expires;
END $$;

CREATE FUNCTION rcat_private.resolve_ordering_visit(p_token_digest bytea)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v rcat.table_ordering_visits%ROWTYPE;t_label text;s_name text;
BEGIN
 IF p_token_digest IS NULL OR octet_length(p_token_digest)<>32 THEN
    RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501'; END IF;
 SELECT visit.* INTO v FROM rcat.table_ordering_visits visit
 JOIN rcat.store_tables tab ON tab.id=visit.table_id
   AND tab.tenant_id=visit.tenant_id AND tab.store_id=visit.store_id
 WHERE visit.token_digest=p_token_digest AND visit.revoked_at IS NULL
   AND visit.expires_at>now() AND tab.active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Visit unavailable' USING ERRCODE='42501'; END IF;
 SELECT t.label,s.display_name INTO t_label,s_name
  FROM rcat.store_tables t
  JOIN rcat.stores s ON s.id=t.store_id AND s.tenant_id=t.tenant_id
 WHERE t.id=v.table_id AND t.tenant_id=v.tenant_id AND t.store_id=v.store_id;
 RETURN jsonb_build_object(
   'visitId',v.id,'storeId',v.store_id,'tableId',v.table_id,
   'tableLabel',t_label,'storeName',s_name,'expiresAt',v.expires_at,
   'categories',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug)
        ORDER BY c.sort_order,c.slug)
      FROM rcat.menu_categories c WHERE c.tenant_id=v.tenant_id
       AND c.store_id=v.store_id
   ),'[]'::jsonb),
   'products',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
        'categoryId',p.category_id,'priceSatang',p.price_satang)
        ORDER BY p.created_at,p.id)
      FROM rcat.menu_products p WHERE p.tenant_id=v.tenant_id
        AND p.store_id=v.store_id AND p.available
   ),'[]'::jsonb)
 );
END $$;

REVOKE ALL ON FUNCTION rcat_private.create_ordering_table(bytea,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.rotate_ordering_visit(bytea,uuid,uuid,uuid,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.resolve_ordering_visit(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.create_ordering_table(bytea,uuid,uuid,text) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.rotate_ordering_visit(bytea,uuid,uuid,uuid,bytea) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.resolve_ordering_visit(bytea) TO rcat_auth;
