\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rcat.users(id,email,password_hash,is_active)
VALUES
 ('10000000-0000-4000-8000-000000000041',
  'first@rcat.ac.th','INVALID_TEST_HASH',true),
 ('10000000-0000-4000-8000-000000000042',
  'second@rcat.ac.th','INVALID_TEST_HASH',true),
 ('10000000-0000-4000-8000-000000000043',
  'disabled@rcat.ac.th','INVALID_TEST_HASH',false);
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  v_actor uuid;
  v_denied boolean:=false;
  v_rows integer;
BEGIN
  BEGIN
    SELECT count(*) INTO v_rows FROM rcat_private.google_identities;
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Auth role read Google identities'; END IF;

  v_actor:=rcat_private.issue_google_workspace_session(
    'first@rcat.ac.th','google-sub-001',
    decode(repeat('61',32),'hex'),decode(repeat('62',32),'hex'));
  IF v_actor<>'10000000-0000-4000-8000-000000000041'::uuid THEN
    RAISE EXCEPTION 'Valid workspace member did not receive session';
  END IF;
  v_actor:=rcat_private.issue_google_workspace_session(
    'first@rcat.ac.th','google-sub-001',
    decode(repeat('63',32),'hex'),decode(repeat('64',32),'hex'));
  IF v_actor<>'10000000-0000-4000-8000-000000000041'::uuid THEN
    RAISE EXCEPTION 'Same Google sub cannot reauthenticate';
  END IF;
  SELECT count(*) INTO v_rows FROM rcat_private.auth_sessions
    WHERE user_id='10000000-0000-4000-8000-000000000041'
      AND revoked_at IS NULL AND expires_at>now()
      AND token_digest IN (decode(repeat('61',32),'hex'),
                           decode(repeat('63',32),'hex'));
  IF v_rows<>2 THEN RAISE EXCEPTION 'Google sessions not durable'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM rcat_private.issue_google_workspace_session(
      'first@rcat.ac.th','google-sub-recycled',
      decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Recycled Workspace email hijacked account'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM rcat_private.issue_google_workspace_session(
      'second@rcat.ac.th','google-sub-001',
      decode(repeat('67',32),'hex'),decode(repeat('68',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Google sub reused by another user'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM rcat_private.issue_google_workspace_session(
      'first@gmail.com','google-sub-001',
      decode(repeat('69',32),'hex'),decode(repeat('6a',32),'hex'));
  EXCEPTION WHEN invalid_parameter_value THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'External email accepted'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM rcat_private.issue_google_workspace_session(
      'missing@rcat.ac.th','google-sub-new',
      decode(repeat('6b',32),'hex'),decode(repeat('6c',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Unapproved user auto-created'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM rcat_private.issue_google_workspace_session(
      'disabled@rcat.ac.th','google-sub-disabled',
      decode(repeat('6d',32),'hex'),decode(repeat('6e',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Disabled user authenticated'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM rcat_private.issue_google_workspace_session(
      'second@rcat.ac.th','google-sub-002',
      decode(repeat('6f',31),'hex'),decode(repeat('70',32),'hex'));
  EXCEPTION WHEN invalid_parameter_value THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Short session digest accepted'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: RCAT Workspace sub binding, session issuance, account recovery resistance and DB role isolation'
