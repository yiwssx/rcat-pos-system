\set ON_ERROR_STOP on
-- Ephemeral PostgreSQL CI only. All data is rolled back.
BEGIN;
INSERT INTO rcat_private.auth_sessions(
  user_id,token_digest,csrf_digest,expires_at
) VALUES(
 '10000000-0000-4000-8000-000000000001',
 decode(repeat('de',32),'hex'),decode(repeat('ec',32),'hex'),
 now()+interval '1 hour'
);
INSERT INTO rcat_private.password_recovery(
 user_id,token_digest,requested_at,expires_at
) VALUES (
 '10000000-0000-4000-8000-000000000002',
 decode(repeat('ee',32),'hex'),now()-interval '60 minutes',
 now()-interval '20 minutes'
);
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE accepted boolean; denied boolean:=false; new_hash text; n integer;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM rcat_private.password_recovery;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Auth role read recovery table'; END IF;

  accepted:=rcat_private.request_password_recovery(
    'unknown@test.invalid',decode(repeat('a0',32),'hex'));
  IF accepted THEN RAISE EXCEPTION 'Unrecognized account requested reset'; END IF;
  accepted:=rcat_private.request_password_recovery(
    'a@test.invalid',decode(repeat('a1',32),'hex'));
  IF NOT accepted THEN RAISE EXCEPTION 'Valid account request denied'; END IF;

  accepted:=rcat_private.request_password_recovery(
    'a@test.invalid',decode(repeat('a2',32),'hex'));
  IF accepted THEN RAISE EXCEPTION 'Cooldown bypassed'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.complete_password_recovery(
      decode(repeat('a2',32),'hex'),
      'scrypt$32768$long-enough-test-digest-0123456789'
    );
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Unissued reset token accepted'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.complete_password_recovery(
      decode(repeat('ee',32),'hex'),
      'scrypt$32768$long-enough-test-digest-0123456789'
    );
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Expired token was accepted'; END IF;

  accepted:=rcat_private.complete_password_recovery(
    decode(repeat('a1',32),'hex'),
    'scrypt$32768$long-enough-test-digest-0123456789'
  );
  IF NOT accepted THEN RAISE EXCEPTION 'Valid reset failed'; END IF;

  SELECT count(*) INTO n FROM rcat_private.auth_sessions
    WHERE token_digest=decode(repeat('de',32),'hex') AND revoked_at IS NULL;
  IF n<>0 THEN RAISE EXCEPTION 'Old session not revoked'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.complete_password_recovery(
      decode(repeat('a1',32),'hex'),
      'scrypt$32768$long-enough-test-digest-0123456789'
    );
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Reset token replay succeeded'; END IF;

  accepted:=rcat_private.issue_session_if_current(
    '10000000-0000-4000-8000-000000000001',
    'OLD_PASSPHRASE_CACHED',
    decode(repeat('a3',32),'hex'),
    decode(repeat('b3',32),'hex')
  );
  IF accepted THEN RAISE EXCEPTION 'Stale password issued a session'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: password recovery expiry/replay, role isolation, cooldown, session revoke, stale-login protection'
