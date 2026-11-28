\set ON_ERROR_STOP on
-- All identifiers/actors are synthetic. No real transfer or provider call.
BEGIN;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 root_session bytea:=decode(repeat('71',32),'hex');
 admin_session bytea:=decode(repeat('72',32),'hex');
 merchant_session bytea:=decode(repeat('73',32),'hex');
 a uuid; t uuid; s uuid; t2 uuid; s2 uuid; v jsonb; denied boolean;
BEGIN
 PERFORM rcat_private.issue_google_workspace_session(
   'admin@rcat.ac.th','ci-platform-payment-root',root_session,decode(repeat('81',32),'hex'));
 a:=rcat_private.manage_platform_account(root_session,'payment-reviewer@rcat.ac.th','admin',true);
 PERFORM rcat_private.manage_platform_account(root_session,'payment-merchant@rcat.ac.th','merchant',true);
 PERFORM rcat_private.issue_google_workspace_session(
   'payment-reviewer@rcat.ac.th','ci-platform-payment-reviewer',admin_session,decode(repeat('82',32),'hex'));
 PERFORM rcat_private.issue_google_workspace_session(
   'payment-merchant@rcat.ac.th','ci-platform-payment-merchant',merchant_session,decode(repeat('83',32),'hex'));
 SELECT tenant_id,store_id INTO t,s FROM rcat_private.create_merchant_for_session(
   root_session,'payment-test-tenant','Payment test','first-shop','First shop');
 SELECT tenant_id,store_id INTO t2,s2 FROM rcat_private.create_merchant_for_session(
   root_session,'payment-other-tenant','Other payment test','other-shop','Other shop');
 PERFORM rcat_private.assign_platform_merchant(root_session,'payment-merchant@rcat.ac.th',t);
 PERFORM rcat_private.assign_platform_merchant(root_session,'payment-merchant@rcat.ac.th',t2);
 PERFORM rcat_private.set_merchant_promptpay_receiver(merchant_session,t,s,'mobile','0812345678',0);
 PERFORM rcat_private.set_merchant_promptpay_receiver(merchant_session,t2,s2,'mobile','0898765432',0);

 v:=rcat_private.platform_payment_overview(admin_session,NULL,50);
 IF (v->>'canReview')::boolean OR jsonb_array_length(v->'items')<>0 OR jsonb_array_length(v->'admins')<>0 THEN
   RAISE EXCEPTION 'Unassigned admin exposed receiver or grant queue';
 END IF;

 denied:=false;
 BEGIN PERFORM rcat_private.platform_payment_overview(merchant_session,NULL,50);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Merchant enumerated platform payment queue'; END IF;

 denied:=false;
 BEGIN PERFORM rcat_private.set_platform_payment_grant(admin_session,a,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Admin self granted'; END IF;

 denied:=false;
 BEGIN PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,1,'approve','0812345678','CI-proof-001',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Undelegated admin approved receiver'; END IF;

 PERFORM rcat_private.set_platform_payment_grant(root_session,a,true);
 v:=rcat_private.platform_payment_overview(admin_session,NULL,50);
 IF NOT (v->>'canReview')::boolean OR v::text LIKE '%0812345678%' OR v::text LIKE '%0898765432%' THEN
   RAISE EXCEPTION 'Delegated queue exposed raw receiver or failed';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x
   WHERE x->>'storeId'=s::text AND x->>'reviewStatus'='pending' AND x->>'maskedReceiver'='****5678') THEN
   RAISE EXCEPTION 'Configured receiver missing or not masked';
 END IF;

 denied:=false;
 BEGIN PERFORM rcat_private.set_platform_payment_policy(admin_session,true,'CI-policy-001',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Admin changed global policy'; END IF;

 denied:=false;
 BEGIN PERFORM rcat_private.set_platform_payment_policy(root_session,true,'CI-policy-001',false);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Release-off policy approval allowed'; END IF;

 denied:=false;
 BEGIN PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,1,'approve','0812345678','CI-proof-001',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Policy-off approval allowed'; END IF;

 PERFORM rcat_private.set_platform_payment_policy(root_session,true,'CI-policy-001',true);
 denied:=false;
 BEGIN PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,1,'approve','0812345678','CI-proof-001',false);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Release-off approval allowed'; END IF;

 denied:=false;
 BEGIN PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,1,'approve','0898765432','CI-proof-001',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Wrong verified ID accepted'; END IF;

 denied:=false;
 BEGIN PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s2,1,'approve','0898765432','CI-proof-001',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Tenant/store mismatch accepted'; END IF;

 -- Existing owner roles are not approval authority; same configuring actor
 -- cannot review a receiver even if also a platform Super Admin.
 PERFORM rcat_private.set_merchant_promptpay_receiver(root_session,t2,s2,'mobile','0811111111',1);
 denied:=false;
 BEGIN PERFORM rcat_private.review_platform_payment_receiver(root_session,t2,s2,2,'approve','0811111111','CI-proof-001',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Configurator approved own receiver'; END IF;

 PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,1,'approve','0812345678','CI-proof-001',true);
 v:=rcat_private.merchant_promptpay_receiver(merchant_session,t,s);
 IF v->>'activationApproved'<>'true' OR v->>'retentionReady'<>'true' OR v->>'enabled'<>'false' THEN
   RAISE EXCEPTION 'Admin approval failed or automatically enabled receiving';
 END IF;
 v:=rcat_private.set_merchant_promptpay_activation(merchant_session,t,s,true,1,true);
 IF v->>'enabled'<>'true' THEN RAISE EXCEPTION 'Merchant activation failed'; END IF;
 denied:=false;
 BEGIN PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,1,'revoke',NULL,'CI-incident-001',false);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale revision accepted'; END IF;
 PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,2,'revoke',NULL,'CI-incident-001',false);
 v:=rcat_private.merchant_promptpay_receiver(merchant_session,t,s);
 IF v->>'enabled'<>'false' OR v->>'activationApproved'<>'false' THEN
   RAISE EXCEPTION 'Revocation did not stop and invalidate approval';
 END IF;

 PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,3,'approve','0812345678','CI-proof-002',true);
 PERFORM rcat_private.set_merchant_promptpay_receiver(merchant_session,t,s,'mobile','0812222222',3);
 v:=rcat_private.merchant_promptpay_receiver(merchant_session,t,s);
 IF v->>'activationApproved'<>'false' THEN RAISE EXCEPTION 'Changed receiver kept approval'; END IF;
 PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,4,'reject',NULL,'CI-proof-003',false);
 v:=rcat_private.platform_payment_overview(admin_session,NULL,50);
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') x
   WHERE x->>'storeId'=s::text AND x->>'reviewStatus'='rejected' AND x->>'reviewedBy'='payment-reviewer@rcat.ac.th') THEN
   RAISE EXCEPTION 'Rejection missing audit actor/status';
 END IF;
 PERFORM rcat_private.set_platform_payment_policy(root_session,false,'CI-policy-002',false);
 denied:=false;
 BEGIN PERFORM rcat_private.review_platform_payment_receiver(admin_session,t,s,5,'approve','0812222222','CI-proof-004',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Paused policy allowed new approval'; END IF;

 -- Regranting an existing Admin (including suspend/resume) clears payment delegation.
 PERFORM rcat_private.manage_platform_account(root_session,'payment-reviewer@rcat.ac.th','admin',true);
 v:=rcat_private.platform_payment_overview(admin_session,NULL,50);
 IF (v->>'canReview')::boolean THEN RAISE EXCEPTION 'Account regrant preserved payment permission'; END IF;
 denied:=false;
 BEGIN UPDATE rcat_private.platform_accounts SET payment_approval_allowed=true WHERE user_id=a;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Runtime direct platform account grant'; END IF;
 denied:=false;
 BEGIN UPDATE rcat_private.payment_web_policy SET approved=true;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Runtime direct policy grant'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM rcat.audit_events WHERE action='payment.receiver.admin_approved'
   AND actor_user_id IS NOT NULL AND metadata->>'approvalRef'='CI-proof-001')
   OR NOT EXISTS (SELECT 1 FROM rcat_private.payment_platform_audit WHERE action='grant' AND actor_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Missing approval/grant audit';
 END IF;
 IF EXISTS (SELECT 1 FROM rcat.audit_events WHERE action LIKE 'payment.receiver.admin_%'
   AND (metadata::text LIKE '%0812345678%' OR metadata::text LIKE '%0898765432%')) THEN
   RAISE EXCEPTION 'Raw receiver leaked to audit';
 END IF;
END $$;
ROLLBACK;
\echo 'PASS: platform payment approval, separate delegation, policy and release locks, independent exact ID review, CAS, revocation, audit, no self-activation'
