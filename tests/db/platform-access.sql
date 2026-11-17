\set ON_ERROR_STOP on
-- New platform permissions must be verified on the disposable CI database only.
BEGIN;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  v_root uuid;v_admin uuid;v_merchant uuid;
  v_tenant uuid;v_store uuid;v_role text;
  v_count integer;v_denied boolean;
BEGIN
  -- The only automatic bootstrap identity is an actual, signed+verified
  -- Google Workspace admin@rcat.ac.th claim. This SQL test models the
  -- already-verified identity passed from the OAuth service, not a web route.
  v_root:=rcat_private.issue_google_workspace_session(
    'admin@rcat.ac.th','ci-root-google-sub',
    decode(repeat('a1',32),'hex'),decode(repeat('a2',32),'hex'));
  SELECT rcat_private.platform_role_for_user(v_root) INTO v_role;
  IF v_role<>'super_admin' THEN
    RAISE EXCEPTION 'Fixed Super Admin first login did not bootstrap';
  END IF;
  SELECT count(*) INTO v_count FROM rcat_private.list_platform_accounts(
    decode(repeat('a1',32),'hex'));
  IF v_count<>1 THEN RAISE EXCEPTION 'First login created unintended staff'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM 1 FROM rcat_private.platform_accounts;
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Runtime role read platform ACL directly'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM rcat_private.issue_google_workspace_session(
      'unapproved@rcat.ac.th','unknown-sub-ci',
      decode(repeat('a3',32),'hex'),decode(repeat('a4',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Unknown Workspace user self-registered'; END IF;

  v_admin:=rcat_private.manage_platform_account(
    decode(repeat('a1',32),'hex'),'assistant@rcat.ac.th','admin',true);
  v_merchant:=rcat_private.manage_platform_account(
    decode(repeat('a1',32),'hex'),'operator@rcat.ac.th','merchant',true);
  IF v_admin IS NULL OR v_merchant IS NULL OR v_admin=v_merchant THEN
    RAISE EXCEPTION 'Manual platform account provisioning failed';
  END IF;
  PERFORM rcat_private.issue_google_workspace_session(
    'assistant@rcat.ac.th','ci-assistant-sub',
    decode(repeat('b1',32),'hex'),decode(repeat('b2',32),'hex'));
  PERFORM rcat_private.issue_google_workspace_session(
    'operator@rcat.ac.th','ci-operator-sub',
    decode(repeat('c1',32),'hex'),decode(repeat('c2',32),'hex'));

  -- Only the original Super Admin can appoint another Admin.
  v_denied:=false;
  BEGIN
    PERFORM rcat_private.manage_platform_account(
      decode(repeat('b1',32),'hex'),'other@rcat.ac.th','admin',true);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Admin elevated another Admin'; END IF;

  -- Admin may approve a Merchant but cannot change a peer Admin or root.
  PERFORM rcat_private.manage_platform_account(
    decode(repeat('b1',32),'hex'),'kitchen@rcat.ac.th','merchant',true);
  v_denied:=false;
  BEGIN
    PERFORM rcat_private.manage_platform_account(
      decode(repeat('b1',32),'hex'),'assistant@rcat.ac.th','merchant',true);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Admin demoted peer Admin'; END IF;
  v_denied:=false;
  BEGIN
    PERFORM rcat_private.manage_platform_account(
      decode(repeat('a1',32),'hex'),'admin@rcat.ac.th','merchant',true);
  EXCEPTION WHEN invalid_parameter_value THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Root identity was mutable'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM 1 FROM rcat_private.list_platform_accounts(
      decode(repeat('c1',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Merchant enumerated private platform list'; END IF;

  -- Super creates a tenant via the existing audited transactional function.
  SELECT tenant_id,store_id INTO v_tenant,v_store
  FROM rcat_private.create_merchant_for_session(
    decode(repeat('a1',32),'hex'),
    'platform-test-rcat','Platform Test','main-store','Main Store');
  IF v_tenant IS NULL OR v_store IS NULL THEN
    RAISE EXCEPTION 'Owner tenant creation failed';
  END IF;
  PERFORM rcat_private.assign_platform_merchant(
    decode(repeat('b1',32),'hex'),'operator@rcat.ac.th',v_tenant);
  SELECT count(*) INTO v_count
  FROM jsonb_array_elements(
    (rcat_private.merchant_store_scopes(decode(repeat('c1',32),'hex')))->'stores'
  ) AS x
  WHERE x->>'role'='owner' AND (x->>'tenantId')::uuid=v_tenant;
  IF v_count<>1 THEN RAISE EXCEPTION 'Approved Merchant missing scoped tenant'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM rcat_private.super_admin_enter_tenant(
      decode(repeat('b1',32),'hex'),v_tenant);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Admin accessed global Super function'; END IF;
  PERFORM rcat_private.super_admin_enter_tenant(
    decode(repeat('a1',32),'hex'),v_tenant);

  -- Suspension must revoke existing sessions and stop future Google logins.
  PERFORM rcat_private.manage_platform_account(
    decode(repeat('b1',32),'hex'),'operator@rcat.ac.th','merchant',false);
  SELECT count(*) INTO v_count FROM rcat_private.auth_sessions
  WHERE user_id=v_merchant AND revoked_at IS NOT NULL
    AND token_digest=decode(repeat('c1',32),'hex');
  IF v_count<>1 THEN RAISE EXCEPTION 'Merchant session was not revoked'; END IF;
  v_denied:=false;
  BEGIN
    PERFORM rcat_private.issue_google_workspace_session(
      'operator@rcat.ac.th','ci-operator-sub',
      decode(repeat('c3',32),'hex'),decode(repeat('c4',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Suspended Merchant signed in again'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: Super Admin bootstrap, manual allowlist, Admin delegation, Merchant tenant scope, revocation and database isolation'
