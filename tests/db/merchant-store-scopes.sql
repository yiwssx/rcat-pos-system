\set ON_ERROR_STOP on
BEGIN;
-- The first fixture owner belongs to tenant A, the second to tenant B.
INSERT INTO rcat.users(id,email,password_hash) VALUES (
 '10000000-0000-4000-8000-000000000003',
 'board-kitchen@test.invalid','INVALID_TEST_HASH');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES (
 '00000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000003','kitchen');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('a1',32),'hex'),decode(repeat('a4',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('a2',32),'hex'),decode(repeat('a5',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000003',
  decode(repeat('a3',32),'hex'),decode(repeat('a6',32),'hex'),
  now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 v_owner jsonb; v_other jsonb; v_kitchen jsonb;
 denied boolean;
BEGIN
 v_owner:=rcat_private.merchant_store_scopes(decode(repeat('a1',32),'hex'));
 IF jsonb_array_length(v_owner->'stores')<>1
   OR v_owner#>>'{stores,0,tenantId}'<>
      '00000000-0000-4000-8000-000000000001'
   OR v_owner#>>'{stores,0,storeId}'<>
      '20000000-0000-4000-8000-000000000001'
   OR v_owner#>>'{stores,0,role}'<>'owner'
   OR (v_owner#>'{stores,0}')?'token'
 THEN RAISE EXCEPTION 'Owner merchant store scope invalid'; END IF;
 v_kitchen:=rcat_private.merchant_store_scopes(decode(repeat('a3',32),'hex'));
 IF jsonb_array_length(v_kitchen->'stores')<>1
   OR v_kitchen#>>'{stores,0,role}'<>'kitchen'
 THEN RAISE EXCEPTION 'Kitchen staff cannot discover scoped store'; END IF;
 v_other:=rcat_private.merchant_store_scopes(decode(repeat('a2',32),'hex'));
 IF jsonb_array_length(v_other->'stores')<>1
   OR v_other#>>'{stores,0,tenantId}'<>
      '00000000-0000-4000-8000-000000000002'
 THEN RAISE EXCEPTION 'Merchant store discovery leaked across tenants'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.merchant_store_scopes(decode(repeat('ff',32),'hex'));
 EXCEPTION WHEN invalid_authorization_specification THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid session could discover stores'; END IF;
 -- This function does not return any raw session or QR capability.
END $$;
ROLLBACK;
\echo 'PASS: session-scoped merchant store discovery, owner/kitchen role and cross-tenant isolation'
