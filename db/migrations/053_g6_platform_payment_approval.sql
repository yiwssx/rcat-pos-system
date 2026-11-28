-- Web-based independent review. Defaults deny all new web approvals.
-- No receiver, release flag, scheduled job or historical payment is enabled here.
ALTER TABLE rcat_private.platform_accounts
  ADD COLUMN payment_approval_allowed boolean NOT NULL DEFAULT false;

-- Existing account management (including suspension/regrant) invalidates delegation.
CREATE FUNCTION rcat_private.reset_payment_approval_grant()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  NEW.payment_approval_allowed:=false;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION rcat_private.reset_payment_approval_grant() FROM PUBLIC;
CREATE TRIGGER reset_payment_approval_grant
BEFORE UPDATE OF role,granted_by,changed_at ON rcat_private.platform_accounts
FOR EACH ROW EXECUTE FUNCTION rcat_private.reset_payment_approval_grant();

CREATE TABLE rcat_private.payment_web_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  approved boolean NOT NULL DEFAULT false
);
INSERT INTO rcat_private.payment_web_policy VALUES(true,false);
CREATE TABLE rcat_private.payment_platform_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  subject_id uuid REFERENCES rcat.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('grant','revoke','policy_approve','policy_pause')),
  approval_ref text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON rcat_private.payment_web_policy,rcat_private.payment_platform_audit
  FROM PUBLIC,rcat_auth,rcat_app;

-- Authorize against current platform role, not browser claims or tenant owner.
-- The session helper locks the active actor; account lock serializes delegation changes.
CREATE FUNCTION rcat_private._payment_platform_actor(
  p_session bytea,p_super boolean,p_grant boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid; r text; allowed boolean;
BEGIN
  a:=rcat_private._require_session_actor(p_session);
  SELECT p.role,p.payment_approval_allowed INTO r,allowed
    FROM rcat_private.platform_accounts p
    WHERE p.user_id=a AND EXISTS (
      SELECT 1 FROM rcat_private.google_identities g WHERE g.user_id=a
    ) FOR SHARE;
  IF r IS NULL OR r NOT IN ('super_admin','admin')
    OR (p_super AND r<>'super_admin')
    OR (p_grant AND r<>'super_admin' AND NOT allowed) THEN
    RAISE EXCEPTION 'Payment administration unavailable' USING ERRCODE='42501';
  END IF;
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION rcat_private._payment_platform_actor(bytea,boolean,boolean)
  FROM PUBLIC,rcat_auth,rcat_app;

CREATE FUNCTION rcat_private.set_platform_payment_grant(
  p_session bytea,p_user uuid,p_allowed boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid;
BEGIN
  a:=rcat_private._payment_platform_actor(p_session,true,false);
  IF p_user IS NULL OR p_allowed IS NULL OR p_user=a THEN
    RAISE EXCEPTION 'Invalid grant' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM rcat.users WHERE id=p_user AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admin unavailable' USING ERRCODE='42501'; END IF;
  UPDATE rcat_private.platform_accounts SET payment_approval_allowed=p_allowed
  WHERE user_id=p_user AND role='admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'Admin unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO rcat_private.payment_platform_audit(actor_id,subject_id,action)
    VALUES(a,p_user,CASE WHEN p_allowed THEN 'grant' ELSE 'revoke' END);
END $$;

-- This policy admits NEW receiver approvals after the independent release and
-- retention/backup go/no-go. Pausing it does not cancel historical obligations.
-- The deployment-level QR/slip switches remain the emergency global stop.
CREATE FUNCTION rcat_private.set_platform_payment_policy(
  p_session bytea,p_approved boolean,p_ref text,p_release_ready boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid;
BEGIN
  a:=rcat_private._payment_platform_actor(p_session,true,false);
  IF p_approved IS NULL OR p_ref IS NULL
    OR p_ref !~ '^[A-Za-z0-9_./:#-]{8,120}$' THEN
    RAISE EXCEPTION 'Invalid approval reference' USING ERRCODE='22023';
  END IF;
  IF p_approved AND p_release_ready IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Payment release unavailable' USING ERRCODE='42501';
  END IF;
  UPDATE rcat_private.payment_web_policy SET approved=p_approved WHERE singleton;
  INSERT INTO rcat_private.payment_platform_audit(actor_id,action,approval_ref)
    VALUES(a,CASE WHEN p_approved THEN 'policy_approve' ELSE 'policy_pause' END,p_ref);
END $$;

CREATE FUNCTION rcat_private.platform_payment_overview(
  p_session bytea,p_after uuid,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid; r text; allowed boolean; policy boolean; items jsonb:='[]'; admins jsonb:='[]';
BEGIN
  a:=rcat_private._payment_platform_actor(p_session,false,false);
  SELECT role,role='super_admin' OR payment_approval_allowed INTO r,allowed
    FROM rcat_private.platform_accounts WHERE user_id=a;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid review limit' USING ERRCODE='22023';
  END IF;
  SELECT approved INTO policy FROM rcat_private.payment_web_policy WHERE singleton;
  IF r='super_admin' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('userId',q.user_id,'email',q.email,
      'allowed',q.payment_approval_allowed) ORDER BY q.email),'[]') INTO admins
    FROM (
      SELECT p.user_id,u.email,p.payment_approval_allowed
      FROM rcat_private.platform_accounts p JOIN rcat.users u ON u.id=p.user_id
      WHERE p.role='admin' AND u.is_active ORDER BY u.email LIMIT 500
    ) q;
  END IF;
  IF allowed THEN
    SELECT coalesce(jsonb_agg(q.item ORDER BY q.store_id),'[]') INTO items
    FROM (
      SELECT x.store_id,jsonb_build_object(
        'tenantId',x.tenant_id,'storeId',x.store_id,'tenantName',t.display_name,
        'storeName',s.display_name,'receiverKind',x.recipient_kind,
        'maskedReceiver','****'||right(x.recipient_identifier,4),
        'enabled',x.enabled,'revision',x.revision,
        'retentionReady',coalesce(x.slip_image_retention_days=90,false),
        'reviewStatus',CASE WHEN x.approved_revision=x.revision THEN 'approved'
          WHEN e.action='payment.receiver.admin_rejected' THEN 'rejected'
          WHEN e.action IN ('payment.receiver.admin_revoked','payment.receiver.operator_revoked')
            THEN 'revoked' ELSE 'pending' END,
        'reviewedAt',e.created_at,'reviewedBy',u.email
      ) item FROM rcat.store_promptpay_receivers x
      JOIN rcat.stores s ON s.tenant_id=x.tenant_id AND s.id=x.store_id
      JOIN rcat.tenants t ON t.id=x.tenant_id
      LEFT JOIN LATERAL (
        SELECT action,created_at,actor_user_id FROM rcat.audit_events e
        WHERE e.tenant_id=x.tenant_id AND e.subject_id=x.store_id
          AND e.action IN ('payment.receiver.admin_approved','payment.receiver.admin_rejected',
            'payment.receiver.admin_revoked','payment.receiver.operator_approved',
            'payment.receiver.operator_revoked')
          AND (
            (x.approved_revision=x.revision
              AND e.action IN ('payment.receiver.admin_approved','payment.receiver.operator_approved'))
            OR e.metadata->>'revision'=x.revision::text
          )
        ORDER BY e.id DESC LIMIT 1
      ) e ON true
      LEFT JOIN rcat.users u ON u.id=e.actor_user_id
      WHERE p_after IS NULL OR x.store_id>p_after
      ORDER BY x.store_id LIMIT p_limit
    ) q;
  END IF;
  RETURN jsonb_build_object('canReview',allowed,'isSuper',r='super_admin',
    'policyApproved',coalesce(policy,false),'items',items,'admins',admins);
END $$;

CREATE FUNCTION rcat_private.review_platform_payment_receiver(
  p_session bytea,p_tenant uuid,p_store uuid,p_revision integer,p_action text,
  p_verified_id text,p_ref text,p_release_ready boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a uuid; r rcat.store_promptpay_receivers%ROWTYPE; policy boolean; configured_by uuid;
  next_revision integer;
BEGIN
  a:=rcat_private._payment_platform_actor(p_session,false,true);
  IF p_tenant IS NULL OR p_store IS NULL OR p_revision IS NULL
    OR p_revision NOT BETWEEN 1 AND 2147483646
    OR p_action IS NULL OR p_action NOT IN ('approve','reject','revoke')
    OR p_ref IS NULL OR p_ref !~ '^[A-Za-z0-9_./:#-]{8,120}$'
    OR (p_action<>'approve' AND p_verified_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid receiver review' USING ERRCODE='22023';
  END IF;
  IF p_action='approve' THEN
    SELECT approved INTO policy FROM rcat_private.payment_web_policy WHERE singleton FOR SHARE;
    IF policy IS DISTINCT FROM true OR p_release_ready IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Payment policy or release unavailable' USING ERRCODE='42501';
    END IF;
  END IF;
  SELECT * INTO r FROM rcat.store_promptpay_receivers
    WHERE tenant_id=p_tenant AND store_id=p_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receiver unavailable' USING ERRCODE='42501'; END IF;
  IF r.revision<>p_revision THEN
    RAISE EXCEPTION 'Receiver revision conflict' USING ERRCODE='P0009';
  END IF;
  next_revision:=r.revision;
  IF p_action='approve' THEN
    -- Compare a privately bank-verified identifier, never return the full stored ID.
    -- This is human ownership verification, not a bank API or self-certification.
    SELECT actor_user_id INTO configured_by FROM rcat.audit_events
      WHERE tenant_id=p_tenant AND subject_id=p_store AND action='payment.receiver.configured'
      ORDER BY id DESC LIMIT 1;
    IF configured_by IS NULL OR configured_by=a OR r.enabled
      OR r.approved_revision=r.revision
      OR p_verified_id IS DISTINCT FROM r.recipient_identifier THEN
      RAISE EXCEPTION 'Independent receiver verification required' USING ERRCODE='42501';
    END IF;
    UPDATE rcat.store_promptpay_receivers
      SET approved_revision=revision,slip_image_retention_days=90,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND store_id=p_store;
  ELSE
    IF p_action='reject' AND (r.enabled OR r.approved_revision=r.revision) THEN
      RAISE EXCEPTION 'Revoke the approved receiver instead' USING ERRCODE='P0009';
    END IF;
    UPDATE rcat.store_promptpay_receivers
      SET enabled=false,approved_revision=NULL,revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND store_id=p_store RETURNING revision INTO next_revision;
  END IF;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
    VALUES(p_tenant,a,CASE p_action WHEN 'approve' THEN 'payment.receiver.admin_approved'
      WHEN 'reject' THEN 'payment.receiver.admin_rejected' ELSE 'payment.receiver.admin_revoked' END,
      p_store,jsonb_build_object('revision',next_revision,'approvalRef',p_ref,
        'receiverKind',r.recipient_kind,'maskedReceiver','****'||right(r.recipient_identifier,4),
        'enabled',false));
END $$;

REVOKE ALL ON FUNCTION rcat_private.set_platform_payment_grant(bytea,uuid,boolean),
  rcat_private.set_platform_payment_policy(bytea,boolean,text,boolean),
  rcat_private.platform_payment_overview(bytea,uuid,integer),
  rcat_private.review_platform_payment_receiver(bytea,uuid,uuid,integer,text,text,text,boolean)
  FROM PUBLIC,rcat_app,rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.set_platform_payment_grant(bytea,uuid,boolean),
  rcat_private.set_platform_payment_policy(bytea,boolean,text,boolean),
  rcat_private.platform_payment_overview(bytea,uuid,integer),
  rcat_private.review_platform_payment_receiver(bytea,uuid,uuid,integer,text,text,text,boolean)
  TO rcat_auth;
