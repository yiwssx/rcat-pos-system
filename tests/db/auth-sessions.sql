\set ON_ERROR_STOP on
-- Requires test fixtures from tests/db/tenant-isolation.sql, run ONLY on ephemeral CI.
BEGIN;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  n integer;
  denied boolean := false;
  hash_value text;
BEGIN
  SELECT password_hash INTO hash_value FROM rcat.users WHERE email='a@test.invalid';
  IF hash_value <> 'INVALID_TEST_HASH' THEN
    RAISE EXCEPTION 'FAIL: auth role cannot read credential verifier';
  END IF;

  INSERT INTO rcat_private.auth_sessions
    (user_id,token_digest,csrf_digest,expires_at)
  VALUES
    ('10000000-0000-4000-8000-000000000001',
     decode(repeat('ab',32),'hex'),decode(repeat('cd',32),'hex'),now()+interval '4 hours');

  SELECT count(*) INTO n FROM rcat_private.auth_sessions
   WHERE token_digest=decode(repeat('ab',32),'hex')
     AND revoked_at IS NULL AND expires_at > now();
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: active session not found'; END IF;

  UPDATE rcat_private.auth_sessions SET revoked_at=now()
   WHERE token_digest=decode(repeat('ab',32),'hex');
  SELECT count(*) INTO n FROM rcat_private.auth_sessions
   WHERE token_digest=decode(repeat('ab',32),'hex')
     AND revoked_at IS NULL AND expires_at > now();
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: revoked session remains usable'; END IF;

  INSERT INTO rcat_private.auth_sessions
   (user_id,token_digest,csrf_digest,created_at,expires_at)
  VALUES
   ('10000000-0000-4000-8000-000000000001',
    decode(repeat('ef',32),'hex'),decode(repeat('12',32),'hex'),
    now()-interval '2 hours',now()-interval '1 hour');
  SELECT count(*) INTO n FROM rcat_private.auth_sessions
   WHERE token_digest=decode(repeat('ef',32),'hex')
     AND revoked_at IS NULL AND expires_at > now();
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: expired token remains active'; END IF;

  BEGIN
    SELECT count(*) INTO n FROM rcat.stores;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: authentication role can read merchant stores'; END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE rcat_app;
DO $$
DECLARE
 n integer;
 denied boolean := false;
BEGIN
 BEGIN SELECT count(*) INTO n FROM rcat_private.auth_sessions;
 EXCEPTION WHEN insufficient_privilege THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL: app role can read auth sessions'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: auth storage roles, 32-byte digests, revocation/expiry, isolation from tenant role'
