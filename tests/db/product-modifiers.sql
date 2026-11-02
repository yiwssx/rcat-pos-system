\set ON_ERROR_STOP on
-- CI ephemeral DB only: all test data is rolled back.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',decode(repeat('d9',32),'hex'),
  decode(repeat('f9',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',decode(repeat('da',32),'hex'),
  decode(repeat('fa',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE category uuid;product uuid;grp uuid;opt uuid;bad_group uuid;
  denied boolean;catalog jsonb;visit jsonb;tbl uuid;
BEGIN
 category:=rcat_private.add_menu_category(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'test-extras','Extras');
 product:=rcat_private.add_menu_product(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  category,'กาแฟ',8000);
 grp:=rcat_private.add_modifier_group(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  product,'sweetness','ความหวาน',1,2);
 opt:=rcat_private.add_modifier_option(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  product,grp,'หวานน้อย',-500);
 PERFORM rcat_private.add_modifier_option(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  product,grp,'น้ำผึ้ง',1500);
 catalog:=rcat_private.catalog_snapshot(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001');
 IF jsonb_array_length(catalog->'modifierGroups')<>1
    OR (catalog#>>'{modifierGroups,0,minSelect}')::int<>1
    OR jsonb_array_length(catalog->'modifierOptions')<>2 THEN
  RAISE EXCEPTION 'Merchant option snapshot incorrect';
 END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.add_modifier_group(
   decode(repeat('d9',32),'hex'),
   '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   product,'invalid-group','invalid',2,1);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'minSelect greater than maxSelect allowed'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.add_modifier_option(
   decode(repeat('da',32),'hex'),
   '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   product,grp,'Cross tenant',100);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Other tenant mutated modifier'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.add_modifier_option(
   decode(repeat('d9',32),'hex'),
   '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   product,'10000000-0000-4000-8000-000000000099','Foreign group',100);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unknown modifier group allowed'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.add_modifier_option(
   decode(repeat('d9',32),'hex'),
   '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   product,grp,'Over maximum allowed',100000001);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Over-range modifier delta allowed'; END IF;
 denied:=false;
 BEGIN
  INSERT INTO rcat.menu_modifier_options(
   tenant_id,store_id,product_id,group_id,name,price_delta_satang
  ) VALUES(
   '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',product,grp,'Direct',100);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Auth role has direct insert'; END IF;
 tbl:=rcat_private.create_ordering_table(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','Add-on table');
 PERFORM rcat_private.rotate_ordering_visit(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',tbl,
  decode(repeat('e9',32),'hex'));
 visit:=rcat_private.resolve_ordering_visit(decode(repeat('e9',32),'hex'));
 IF jsonb_array_length(visit->'modifierGroups')<>1 OR
    jsonb_array_length(visit->'modifierOptions')<>2 OR
    (visit#>>'{modifierOptions,0,priceDeltaSatang}')::bigint NOT IN (-500,1500)
 THEN RAISE EXCEPTION 'Guest modifier snapshot incorrect'; END IF;
 PERFORM rcat_private.set_modifier_option_availability(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',product,grp,opt,false);
 visit:=rcat_private.resolve_ordering_visit(decode(repeat('e9',32),'hex'));
 IF jsonb_array_length(visit->'modifierOptions')<>1 THEN
  RAISE EXCEPTION 'Unavailable modifier still appears for guest'; END IF;
 PERFORM rcat_private.set_menu_product_availability(
  decode(repeat('d9',32),'hex'),
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',product,false);
 visit:=rcat_private.resolve_ordering_visit(decode(repeat('e9',32),'hex'));
 IF jsonb_array_length(visit->'modifierGroups')<>0
    OR jsonb_array_length(visit->'modifierOptions')<>0 THEN
  RAISE EXCEPTION 'Guest sees modifiers of sold-out product'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.menu_modifier_groups)<>0
    OR (SELECT count(*) FROM rcat.menu_modifier_options)<>0 THEN
   RAISE EXCEPTION 'Tenant B can read Tenant A modifiers'; END IF;
END $$;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000001',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.menu_modifier_groups)<>1
    OR (SELECT count(*) FROM rcat.menu_modifier_options)<>2 THEN
   RAISE EXCEPTION 'Tenant A modifier RLS is incorrect'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: add-on cardinalities, signed satang deltas, guest visibility, tenant RLS and privilege denial'
