\set ON_ERROR_STOP on
-- G5-M1: owner-only tenant-bound receiver setup, optimistic revision,
-- disabled-by-default, masked audit and zero direct DB access.
-- EPHEMERAL CI TRANSACTION ONLY, with synthetic identifiers.
BEGIN;
INSERT INTO rcat.users(id,email,password_hash) VALUES
 ('10000000-0000-4000-8000-000000000003',
  'g5-cashier@test.invalid','TEST_HASH_NO_LOGIN');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','cashier');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('a1',32),'hex'),decode(repeat('b1',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('a2',32),'hex'),decode(repeat('b2',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000003',
  decode(repeat('a3',32),'hex'),decode(repeat('b3',32),'hex'),
  now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 tenant uuid:='00000000-0000-4000-8000-000000000001';
 store uuid:='20000000-0000-4000-8000-000000000001';
 owner bytea:=decode(repeat('a1',32),'hex');
 other bytea:=decode(repeat('a2',32),'hex');
 cashier bytea:=decode(repeat('a3',32),'hex');
 v jsonb;
 denied boolean;
BEGIN
 v:=rcat_private.merchant_promptpay_receiver(owner,tenant,store);
 IF (v->>'configured')::boolean IS DISTINCT FROM false
   OR (v->>'revision')::integer<>0
   OR (v->>'enabled')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Absent receiver should be disabled with version zero';
 END IF;
 v:=rcat_private.set_merchant_promptpay_receiver(
   owner,tenant,store,'mobile','0812345678',0);
 IF (v->>'configured')::boolean IS DISTINCT FROM true
   OR (v->>'changed')::boolean IS DISTINCT FROM true
   OR (v->>'revision')::integer<>1
   OR v->>'maskedReceiver'<>'****5678'
   OR v ? 'receiverId'
   OR (v->>'enabled')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Created receiver exposed secret or was enabled';
 END IF;
 v:=rcat_private.merchant_promptpay_receiver(owner,tenant,store);
 IF v->>'maskedReceiver'<>'****5678' OR v ? 'receiverId' THEN
   RAISE EXCEPTION 'Receiver read disclosed full identifier';
 END IF;
 v:=rcat_private.set_merchant_promptpay_receiver(
   owner,tenant,store,'mobile','0812345678',1);
 IF (v->>'changed')::boolean IS DISTINCT FROM false
   OR (v->>'revision')::integer<>1 THEN
   RAISE EXCEPTION 'Idempotent same revision/receiver change failed';
 END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.set_merchant_promptpay_receiver(
     owner,tenant,store,'mobile','0811111111',0);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale revision overwrote receiver'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_promptpay_receiver(other,tenant,store);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant receiver visible'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.set_merchant_promptpay_receiver(
     cashier,tenant,store,'mobile','0811111111',1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cashier modified receiver'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_promptpay_receiver(cashier,tenant,store);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cashier saw receiver settings'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.set_merchant_promptpay_receiver(
     owner,tenant,store,'mobile','1234567890',1);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Ordinary bank account was allowed'; END IF;
 denied:=false;
 BEGIN
   PERFORM count(*) FROM rcat.store_promptpay_receivers;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Runtime role read receiver table'; END IF;
 denied:=false;
 BEGIN
   PERFORM count(*) FROM rcat.payment_requests;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Runtime role read payment requests'; END IF;
 v:=rcat_private.set_merchant_promptpay_receiver(
   owner,tenant,store,'national_id','1234567890123',1);
 IF (v->>'revision')::integer<>2 OR
   v->>'maskedReceiver'<>'****0123' OR
   (v->>'enabled')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Receiver update failed to preserve disabled state';
 END IF;
END $$;
RESET ROLE;
DO $$
DECLARE
 tenant uuid:='00000000-0000-4000-8000-000000000001';
 store uuid:='20000000-0000-4000-8000-000000000001';
BEGIN
 IF (SELECT count(*) FROM rcat.audit_events
     WHERE tenant_id=tenant AND subject_id=store
       AND action='payment.receiver.configured')<>2 THEN
   RAISE EXCEPTION 'Audit count was not exactly two changed versions';
 END IF;
 IF EXISTS(
   SELECT 1 FROM rcat.audit_events
   WHERE action='payment.receiver.configured'
     AND (metadata::text LIKE '%0812345678%' OR
          metadata::text LIKE '%1234567890123%')
 ) THEN
   RAISE EXCEPTION 'Sensitive receiver was written to audit';
 END IF;
 IF (SELECT count(*) FROM rcat.store_promptpay_receivers
     WHERE tenant_id=tenant AND store_id=store AND enabled=false
       AND recipient_kind='national_id' AND revision=2)<>1 THEN
   RAISE EXCEPTION 'Receiver CAS or disabled default was violated';
 END IF;
END $$;
ROLLBACK;
\echo 'PASS: merchant PromptPay CAS, owner scope, mask, RLS and disabled default'
