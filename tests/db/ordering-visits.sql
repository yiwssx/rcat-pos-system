\set ON_ERROR_STOP on
-- EPHEMERAL DB TEST; all fixtures are rolled back.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',decode(repeat('c9',32),'hex'),
  decode(repeat('e9',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',decode(repeat('ca',32),'hex'),
  decode(repeat('ea',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE t uuid;v jsonb;denied boolean;first_id uuid;next_id uuid;
BEGIN
 t:=rcat_private.create_ordering_table(
   decode(repeat('c9',32),'hex'),
   '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','โต๊ะ 1');
 IF t IS NULL THEN RAISE EXCEPTION 'Could not create table'; END IF;
 SELECT visit_id INTO first_id FROM rcat_private.rotate_ordering_visit(
   decode(repeat('c9',32),'hex'),
   '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',t,
   decode(repeat('b1',32),'hex'));
 v:=rcat_private.resolve_ordering_visit(decode(repeat('b1',32),'hex'));
 IF (v->>'visitId')::uuid<>first_id OR v->>'tableLabel'<>'โต๊ะ 1'
 THEN RAISE EXCEPTION 'Valid visit resolves wrong table'; END IF;
 IF jsonb_array_length(v->'products')<>0 THEN
    RAISE EXCEPTION 'Unexpected public products in empty catalog'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.rotate_ordering_visit(
     decode(repeat('c9',32),'hex'),
     '00000000-0000-4000-8000-000000000002',
     '20000000-0000-4000-8000-000000000002',t,
     decode(repeat('b2',32),'hex'));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant visit rotation'; END IF;
 SELECT visit_id INTO next_id FROM rcat_private.rotate_ordering_visit(
   decode(repeat('c9',32),'hex'),
   '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',t,
   decode(repeat('b3',32),'hex'));
 IF next_id=first_id THEN RAISE EXCEPTION 'Visit not rotated'; END IF;
 denied:=false;
 BEGIN PERFORM rcat_private.resolve_ordering_visit(decode(repeat('b1',32),'hex'));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Revoked visit still accepted'; END IF;
 denied:=false;
 BEGIN PERFORM rcat_private.resolve_ordering_visit(decode(repeat('ff',32),'hex'));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Forged token accepted'; END IF;
 denied:=false;
 BEGIN INSERT INTO rcat.store_tables(tenant_id,store_id,label)
   VALUES ('00000000-0000-4000-8000-000000000001',
           '20000000-0000-4000-8000-000000000001','Bypass');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Auth role has direct table writes'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.store_tables)<>0 THEN
    RAISE EXCEPTION 'Tenant B sees A table'; END IF;
 IF (SELECT count(*) FROM rcat.table_ordering_visits)<>0 THEN
    RAISE EXCEPTION 'Tenant B sees A table visits'; END IF;
END $$;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000001',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.store_tables)<>1 THEN
    RAISE EXCEPTION 'Tenant A cannot read own table'; END IF;
 IF (SELECT count(*) FROM rcat.table_ordering_visits)<>2 THEN
    RAISE EXCEPTION 'Tenant A visit history incorrect'; END IF;
END $$;
RESET ROLE;
UPDATE rcat.table_ordering_visits
 SET issued_at=now()-interval '7 hours',expires_at=now()-interval '1 hour'
 WHERE token_digest=decode(repeat('b3',32),'hex');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM rcat_private.resolve_ordering_visit(decode(repeat('b3',32),'hex'));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Expired visit still accepted'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: table ordering visits rotate, revoke, expire and isolate by tenant'
