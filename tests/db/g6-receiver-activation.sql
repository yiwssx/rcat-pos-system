\set ON_ERROR_STOP on
-- G6: synthetic transactional acceptance only. No bank information or real transfers.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  decode(repeat('b7',32),'hex'),decode(repeat('b8',32),'hex'),now()+interval '1 hour'
);
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 t uuid:='00000000-0000-4000-8000-000000000001';
 s uuid:='20000000-0000-4000-8000-000000000001';
 auth bytea:=decode(repeat('b7',32),'hex');
 v jsonb; blocked boolean:=false;
BEGIN
 v:=rcat_private.set_merchant_promptpay_receiver(
   auth,t,s,'mobile','0812345678',0);
 IF v->>'activationApproved'<>'false' OR (v->>'enabled')::boolean THEN
   RAISE EXCEPTION 'New receiver must not be approved/enabled';
 END IF;
 BEGIN
   PERFORM rcat_private.set_merchant_promptpay_activation(
     auth,t,s,true,1,true);
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Self activation before approval'; END IF;
 blocked:=false;
 BEGIN
   UPDATE rcat.store_promptpay_receivers SET approved_revision=revision;
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Runtime granted approval'; END IF;
END $$;
RESET ROLE;
-- Independent operator review is simulated ONLY under the CI migration owner.
UPDATE rcat.store_promptpay_receivers SET approved_revision=revision
WHERE tenant_id='00000000-0000-4000-8000-000000000001'
  AND store_id='20000000-0000-4000-8000-000000000001'
  AND enabled=false;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 t uuid:='00000000-0000-4000-8000-000000000001';
 s uuid:='20000000-0000-4000-8000-000000000001';
 auth bytea:=decode(repeat('b7',32),'hex');
 other bytea:=decode(repeat('a2',32),'hex');
 v jsonb; blocked boolean;
BEGIN
 v:=rcat_private.merchant_promptpay_receiver(auth,t,s);
 IF v->>'activationApproved'<>'true' OR v ? 'recipient_identifier' THEN
   RAISE EXCEPTION 'Approved state not masked correctly';
 END IF;
 blocked:=false;
 BEGIN
   PERFORM rcat_private.set_merchant_promptpay_activation(
     auth,t,s,true,1,false);
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Release-off activation accepted'; END IF;
 blocked:=false;
 BEGIN
   PERFORM rcat_private.set_merchant_promptpay_activation(
     other,t,s,true,1,true);
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Cross-tenant activation accepted'; END IF;
 v:=rcat_private.set_merchant_promptpay_activation(auth,t,s,true,1,true);
 IF v->>'enabled'<>'true' OR v->>'activationApproved'<>'true' OR
   (v->>'revision')::integer<>2 THEN
   RAISE EXCEPTION 'Approved activation not persisted with CAS';
 END IF;
 v:=rcat_private.set_merchant_promptpay_activation(auth,t,s,true,2,true);
 IF v->>'changed'<>'false' THEN
   RAISE EXCEPTION 'Idempotent activation should have no extra audit';
 END IF;
 blocked:=false;
 BEGIN
   PERFORM rcat_private.set_merchant_promptpay_activation(
     auth,t,s,false,1,false);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Stale update accepted'; END IF;
 v:=rcat_private.set_merchant_promptpay_activation(auth,t,s,false,2,false);
 IF v->>'enabled'<>'false' OR v->>'activationApproved'<>'true' OR
   (v->>'revision')::integer<>3 THEN
   RAISE EXCEPTION 'Pause failed or incorrectly revoked routine approval';
 END IF;
 v:=rcat_private.set_merchant_promptpay_receiver(
   auth,t,s,'mobile','0899999999',3);
 IF v->>'activationApproved'<>'false' OR
   (v->>'revision')::integer<>4 THEN
   RAISE EXCEPTION 'Recipient changed but approval persisted';
 END IF;
 blocked:=false;
 BEGIN
   PERFORM rcat_private.set_merchant_promptpay_activation(
     auth,t,s,true,4,true);
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Receiver replacement bypassed G6'; END IF;
END $$;
RESET ROLE;
-- Simulate new independent operator validation followed by ordinary enable.
UPDATE rcat.store_promptpay_receivers SET approved_revision=revision
WHERE tenant_id='00000000-0000-4000-8000-000000000001'
  AND store_id='20000000-0000-4000-8000-000000000001';
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 v jsonb;
BEGIN
 v:=rcat_private.set_merchant_promptpay_activation(
  decode(repeat('b7',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',true,4,true);
 IF (v->>'revision')::integer<>5 THEN
   RAISE EXCEPTION 'Reapproved receiver failed activation';
 END IF;
END $$;
RESET ROLE;
-- Existing DBA emergency stop increments revision WITHOUT extending approval.
UPDATE rcat.store_promptpay_receivers SET enabled=false,revision=revision+1
WHERE tenant_id='00000000-0000-4000-8000-000000000001'
  AND store_id='20000000-0000-4000-8000-000000000001';
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 v jsonb; blocked boolean:=false;
BEGIN
 v:=rcat_private.merchant_promptpay_receiver(
   decode(repeat('b7',32),'hex'),
   '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001');
 IF v->>'activationApproved'<>'false' OR (v->>'revision')::integer<>6 THEN
   RAISE EXCEPTION 'DBA stop failed to invalidate approval';
 END IF;
 BEGIN
   PERFORM rcat_private.set_merchant_promptpay_activation(
     decode(repeat('b7',32),'hex'),
     '00000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001',true,6,true);
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Emergency stop could be bypassed by web'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM rcat.audit_events
   WHERE action LIKE 'payment.receiver.merchant_%'
     AND metadata::text LIKE '%0812345678%'
 ) THEN
   RAISE EXCEPTION 'Full PromptPay receiver leaked into audit';
 END IF;
 IF (SELECT count(*) FROM rcat.audit_events
     WHERE action IN ('payment.receiver.merchant_enabled',
       'payment.receiver.merchant_paused'))<>3 THEN
   RAISE EXCEPTION 'Expected exact audited activation/pause transitions';
 END IF;
END $$;
ROLLBACK;
\echo 'PASS: G6 approval, no self-approval, tenant scope, release flag, CAS, pause, recipient change, emergency stop'
