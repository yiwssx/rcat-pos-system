\set ON_ERROR_STOP on
BEGIN;
-- Ephemeral fixture, always rolled back. Existing user A owns tenant A;
-- user B owns tenant B and is temporarily added as cashier to tenant A.
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES('00000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000002','cashier');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('b1',32),'hex'),decode(repeat('b2',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('b3',32),'hex'),decode(repeat('b4',32),'hex'),
  now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  a uuid:='00000000-0000-4000-8000-000000000001';
  store_a uuid:='20000000-0000-4000-8000-000000000001';
  b uuid:='00000000-0000-4000-8000-000000000002';
  store_b uuid:='20000000-0000-4000-8000-000000000002';
  owner_token bytea:=decode(repeat('b1',32),'hex');
  cashier_token bytea:=decode(repeat('b3',32),'hex');
  ingredient uuid; foreign_ingredient uuid;
  category uuid; product uuid;
  movement jsonb; replay jsonb; snapshot jsonb;
  bad boolean;
BEGIN
  ingredient:=rcat_private.inventory_create_item(
    owner_token,a,store_a,'ข้าวสาร','g',1000.000);
  IF ingredient IS NULL THEN RAISE EXCEPTION 'Inventory create failed'; END IF;
  snapshot:=rcat_private.inventory_snapshot(owner_token,a,store_a);
  IF snapshot->>'stockMode'<>'manual_ledger_only'
    OR snapshot->>'orderConsumptionEnabled'<>'false'
    OR jsonb_array_length(snapshot->'items')<>1
    OR (snapshot#>>'{items,0,onHand}')::numeric<>0
  THEN RAISE EXCEPTION 'Inventory initial snapshot wrong: %',snapshot; END IF;

  movement:=rcat_private.inventory_move(
    owner_token,a,store_a,ingredient,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','receipt',
    2000.125,'รับสินค้าจากผู้ขาย');
  IF movement->>'replayed'<>'false' OR
    (movement->>'onHand')::numeric<>2000.125
  THEN RAISE EXCEPTION 'Receipt result incorrect: %',movement; END IF;
  replay:=rcat_private.inventory_move(
    owner_token,a,store_a,ingredient,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','receipt',
    2000.125,'รับสินค้าจากผู้ขาย');
  IF replay->>'replayed'<>'true'
     OR replay->>'movementId'<>movement->>'movementId'
     OR (replay->>'onHand')::numeric<>2000.125
  THEN RAISE EXCEPTION 'Idempotency replay failed'; END IF;
  snapshot:=rcat_private.inventory_snapshot(owner_token,a,store_a);
  IF jsonb_array_length(snapshot->'recentMovements')<>1
  THEN RAISE EXCEPTION 'Retry created a duplicate stock movement'; END IF;

  bad:=false;
  BEGIN
    PERFORM rcat_private.inventory_move(
      owner_token,a,store_a,ingredient,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','receipt',
      900.000,'different payload');
  EXCEPTION WHEN unique_violation THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Same idempotency key changed stock'; END IF;

  movement:=rcat_private.inventory_move(
    owner_token,a,store_a,ingredient,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','adjustment',
    -100.125,'ปรับปรุงสินค้าชำรุด');
  IF (movement->>'onHand')::numeric<>1900 THEN
    RAISE EXCEPTION 'Adjustment lost decimal precision'; END IF;
  bad:=false;
  BEGIN
    PERFORM rcat_private.inventory_move(
      owner_token,a,store_a,ingredient,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','adjustment',
      -1900.001,'ปรับปรุงมากเกิน');
  EXCEPTION WHEN invalid_parameter_value THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Negative stock allowed'; END IF;

  category:=rcat_private.add_menu_category(
    owner_token,a,store_a,'inventory-food','อาหารสต็อก');
  product:=rcat_private.add_menu_product(
    owner_token,a,store_a,category,'ข้าวต้ม',7900);
  PERFORM rcat_private.inventory_set_recipe(
    owner_token,a,store_a,product,ingredient,125.500);
  snapshot:=rcat_private.inventory_snapshot(owner_token,a,store_a);
  IF jsonb_array_length(snapshot->'recipes')<>1 OR
     (snapshot#>>'{recipes,0,quantityPerProduct}')::numeric<>125.5 OR
     (snapshot#>>'{items,0,onHand}')::numeric<>1900
  THEN RAISE EXCEPTION 'Recipe changed manual stock balance: %',snapshot; END IF;

  bad:=false;
  BEGIN
    PERFORM rcat_private.inventory_set_recipe(
      owner_token,a,store_a,product,ingredient,-1);
  EXCEPTION WHEN invalid_parameter_value THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Negative recipe quantity accepted'; END IF;

  foreign_ingredient:=rcat_private.inventory_create_item(
    cashier_token,b,store_b,'private-store','unit',0);
  bad:=false;
  BEGIN
    PERFORM rcat_private.inventory_set_recipe(
      owner_token,a,store_a,product,foreign_ingredient,1);
  EXCEPTION WHEN insufficient_privilege THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Cross-tenant ingredient linked'; END IF;
  bad:=false;
  BEGIN
    PERFORM rcat_private.inventory_move(
      owner_token,a,store_a,foreign_ingredient,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd','receipt',1,'wrong store');
  EXCEPTION WHEN insufficient_privilege THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Cross-tenant inventory mutated'; END IF;

  bad:=false;
  BEGIN
    PERFORM rcat_private.inventory_snapshot(cashier_token,a,store_a);
  EXCEPTION WHEN insufficient_privilege THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Cashier accessed inventory'; END IF;
  bad:=false;
  BEGIN
    PERFORM rcat_private.inventory_create_item(
      cashier_token,a,store_a,'cashier-write','unit',0);
  EXCEPTION WHEN insufficient_privilege THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Cashier created inventory'; END IF;
  bad:=false;
  BEGIN
    PERFORM rcat_private.inventory_snapshot(owner_token,b,store_b);
  EXCEPTION WHEN insufficient_privilege THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Owner accessed foreign tenant'; END IF;
  bad:=false;
  BEGIN
    PERFORM rcat_private.inventory_snapshot(
      decode(repeat('ff',32),'hex'),a,store_a);
  EXCEPTION WHEN invalid_authorization_specification THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Forged session accessed inventory'; END IF;
  bad:=false;
  BEGIN
    INSERT INTO rcat.inventory_items(tenant_id,store_id,name,unit)
    VALUES(a,store_a,'illegal','g');
  EXCEPTION WHEN insufficient_privilege THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'Auth role has raw stock table insert'; END IF;

  PERFORM rcat_private.inventory_set_recipe(
    owner_token,a,store_a,product,ingredient,0);
  snapshot:=rcat_private.inventory_snapshot(owner_token,a,store_a);
  IF jsonb_array_length(snapshot->'recipes')<>0
     OR jsonb_array_length(snapshot->'recentMovements')<>2
     OR (snapshot#>>'{items,0,onHand}')::numeric<>1900
  THEN RAISE EXCEPTION 'Recipe removal affected stock or movement ledger'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: inventory decimal ledger, retries, no negative stock, recipe metadata, cross-tenant/RBAC and audit isolation'
