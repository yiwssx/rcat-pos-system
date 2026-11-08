\set ON_ERROR_STOP on
-- CI-only rollback: owner/manager editor, stale versions, tenant denial, audit.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('6a',32),'hex'),decode(repeat('6b',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('6c',32),'hex'),decode(repeat('6d',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 a uuid:='00000000-0000-4000-8000-000000000001';
 b uuid:='00000000-0000-4000-8000-000000000002';
 sa uuid:='20000000-0000-4000-8000-000000000001';
 sb uuid:='20000000-0000-4000-8000-000000000002';
 owner bytea:=decode(repeat('6a',32),'hex');
 other bytea:=decode(repeat('6c',32),'hex');
 category uuid; product uuid; group_id uuid; option_id uuid;
 v jsonb; snapshot jsonb; denied boolean;
BEGIN
 category:=rcat_private.add_menu_category(owner,a,sa,'food-cas','Food before');
 product:=rcat_private.add_menu_product(owner,a,sa,category,'ชา',4500);
 group_id:=rcat_private.add_modifier_group(owner,a,sa,product,
   'toppings','ท็อปปิ้ง',0,2);
 option_id:=rcat_private.add_modifier_option(owner,a,sa,product,group_id,
   'นม',500);
 v:=rcat_private.edit_catalog_category(owner,a,sa,category,
   'Food before','food-cas','อาหารไทย','thai-food-cas');
 IF v->>'name'<>'อาหารไทย' OR NOT (v->>'changed')::boolean THEN
   RAISE EXCEPTION 'Category edit failed'; END IF;
 v:=rcat_private.edit_catalog_category(owner,a,sa,category,
   'อาหารไทย','thai-food-cas','อาหารไทย','thai-food-cas');
 IF (v->>'changed')::boolean THEN RAISE EXCEPTION 'No-op category audited'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.edit_catalog_category(owner,a,sa,category,
   'Food before','food-cas','stale','stale-category');
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale category update accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.edit_catalog_category(other,a,sa,category,
   'อาหารไทย','thai-food-cas','unauthorized','wrong-tenant');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross tenant category write accepted'; END IF;
 v:=rcat_private.edit_modifier_group(owner,a,sa,product,group_id,
   'ท็อปปิ้ง','toppings',0,2,'เลือกระดับความหวาน','sweetness-edit',1,1);
 IF NOT (v->>'changed')::boolean THEN
  RAISE EXCEPTION 'Modifier group edit failed'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.edit_modifier_group(owner,a,sa,product,group_id,
   'ท็อปปิ้ง','toppings',0,2,'stale','stale-group',0,1);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale group edit accepted'; END IF;
 v:=rcat_private.edit_modifier_option(owner,a,sa,product,group_id,option_id,
   'นม',500,true,'นมข้น',-300,false);
 IF NOT (v->>'changed')::boolean THEN
  RAISE EXCEPTION 'Modifier option edit failed'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.edit_modifier_option(owner,a,sa,product,group_id,option_id,
   'นม',500,true,'stale option',-999,true);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale option edit accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.edit_modifier_option(other,a,sa,product,group_id,option_id,
   'นมข้น',-300,false,'breach',100,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross tenant option edit accepted'; END IF;
 snapshot:=rcat_private.catalog_products_page(owner,a,sa,
   '',NULL,false,NULL,NULL,20);
 IF snapshot#>>'{categories,0,name}'<>'อาหารไทย'
   OR snapshot#>>'{modifierGroups,0,name}'<>'เลือกระดับความหวาน'
   OR snapshot#>>'{modifierOptions,0,name}'<>'นมข้น'
   OR (snapshot#>>'{modifierOptions,0,priceDeltaSatang}')::integer<>-300
   OR (snapshot#>>'{modifierOptions,0,available}')::boolean
 THEN RAISE EXCEPTION 'Catalog page returned stale editor fields'; END IF;
 denied:=false;
 BEGIN
  PERFORM rcat_private.edit_modifier_group(owner,a,sa,product,group_id,
   'เลือกระดับความหวาน','sweetness-edit',1,1,
   'invalid','invalid-group',3,1);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid modifier cardinality accepted'; END IF;
 PERFORM set_config('test.catalog_editor_category',category::text,true);
 PERFORM set_config('test.catalog_editor_group',group_id::text,true);
 PERFORM set_config('test.catalog_editor_option',option_id::text,true);
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.audit_events
     WHERE action='catalog.category.updated'
       AND subject_id=current_setting('test.catalog_editor_category')::uuid)<>1
 THEN RAISE EXCEPTION 'Category audit count incorrect'; END IF;
 IF (SELECT count(*) FROM rcat.audit_events
     WHERE action='catalog.modifier.group.updated'
       AND subject_id=current_setting('test.catalog_editor_group')::uuid)<>1
 THEN RAISE EXCEPTION 'Group audit count incorrect'; END IF;
 IF (SELECT count(*) FROM rcat.audit_events
     WHERE action='catalog.modifier.option.updated'
       AND subject_id=current_setting('test.catalog_editor_option')::uuid)<>1
 THEN RAISE EXCEPTION 'Option audit count incorrect'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: category/group/option CAS, cross-tenant denial, immutable ids and exact audit'
