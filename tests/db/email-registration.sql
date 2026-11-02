\set ON_ERROR_STOP on
-- CI-only ephemeral database, run before operator/HTTP fixtures are used.
BEGIN;
INSERT INTO rcat_private.pending_registrations
 (email,password_hash,token_digest,requested_at,expires_at)
VALUES
 ('expired-signup@test.invalid','scrypt$32768$dummy-placeholder-longer-than-40-chars-123456',
  decode(repeat('a3',32),'hex'),
  now()-interval '2 hours',now()-interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE v_ok boolean; v_user uuid; denied boolean:=false; n integer;
BEGIN
  -- Direct pending-table access is not granted to the API auth role.
  BEGIN
    SELECT count(*) INTO n FROM rcat_private.pending_registrations;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'auth role can read registration hashes'; END IF;

  v_ok:=rcat_private.request_email_registration(
    'verify-me@test.invalid','scrypt$32768$test-placeholder-longer-than-40-chars-123456',
    decode(repeat('a1',32),'hex'));
  IF NOT v_ok THEN RAISE EXCEPTION 'new pending registration rejected'; END IF;
  v_ok:=rcat_private.request_email_registration(
    'verify-me@test.invalid','scrypt$32768$test-placeholder-longer-than-40-chars-123456',
    decode(repeat('a2',32),'hex'));
  IF v_ok THEN RAISE EXCEPTION 'duplicate registration bypassed request cooldown'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.complete_email_registration(decode(repeat('a2',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'unissued digest verified'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.complete_email_registration(decode(repeat('a3',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'expired verification token was accepted'; END IF;

  v_user:=rcat_private.complete_email_registration(decode(repeat('a1',32),'hex'));
  IF v_user IS NULL THEN RAISE EXCEPTION 'valid verification failed'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.complete_email_registration(decode(repeat('a1',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'verification token replay succeeded'; END IF;

  v_ok:=rcat_private.request_email_registration(
    'verify-me@test.invalid','scrypt$32768$test-placeholder-longer-than-40-chars-123456',
    decode(repeat('a4',32),'hex'));
  IF v_ok THEN RAISE EXCEPTION 'existing account was re-registered'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: pending registration data isolation, cooldown, expiry, email claim and one-time verification'
