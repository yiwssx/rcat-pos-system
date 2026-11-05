\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','manager');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
('10000000-0000-4000-8000-000000000001',
 decode(repeat('c1',32),'hex'),decode(repeat('c2',32),'hex'),now()+interval '1 hour'),
('10000000-0000-4000-8000-000000000002',
 decode(repeat('c3',32),'hex'),decode(repeat('c4',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 t uuid:='00000000-0000-4000-8000-000000000001';
 s uuid:='20000000-0000-4000-8000-000000000001';
 other_t uuid:='00000000-0000-4000-8000-000000000002';
 other_s uuid:='20000000-0000-4000-8000-000000000002';
 owner bytea:=decode(repeat('c1',32),'hex');
 manager bytea:=decode(repeat('c3',32),'hex');
 item uuid; item_other uuid; take uuid; stale_take uuid; reject_take uuid;
 r jsonb; list jsonb;bad boolean;i integer;
BEGIN
 item:=rcat_private.inventory_create_item(owner,t,s,'Stocktake rice','g',100);
 item_other:=rcat_private.inventory_create_item(owner,t,s,'Stocktake broth','ml',100);
 PERFORM rcat_private.inventory_move(owner,t,s,item,
 'cccccccc-cccc-4ccc-8ccc-cccccccc0011','receipt',1000.125,
 'Fixture initial stock');
 r:=rcat_private.inventory_open_stocktake(owner,t,s,item,
   'cccccccc-cccc-4ccc-8ccc-cccccccc0012');
 take:=(r->>'stocktakeId')::uuid;
 IF r->>'state'<>'open' OR r->>'baselineOnHand'<>'1000.125'
   OR r->>'replayed'<>'false' THEN
   RAISE EXCEPTION 'Open stocktake baseline invalid: %',r; END IF;
 r:=rcat_private.inventory_open_stocktake(owner,t,s,item,
   'cccccccc-cccc-4ccc-8ccc-cccccccc0012');
 IF r->>'replayed'<>'true' OR (r->>'stocktakeId')::uuid<>take
 THEN RAISE EXCEPTION 'Opening retry not idempotent'; END IF;
 bad:=false;
 BEGIN
   PERFORM rcat_private.inventory_open_stocktake(owner,t,s,item,
     'cccccccc-cccc-4ccc-8ccc-cccccccc0013');
 EXCEPTION WHEN unique_violation THEN bad:=true; END;
 IF NOT bad THEN RAISE EXCEPTION 'Parallel open stocktake allowed'; END IF;
 bad:=false;
 BEGIN
   PERFORM rcat_private.inventory_open_stocktake(owner,t,s,item_other,
     'cccccccc-cccc-4ccc-8ccc-cccccccc0012');
 EXCEPTION WHEN unique_violation THEN bad:=true; END;
 IF NOT bad THEN RAISE EXCEPTION 'Idempotency key reused across items'; END IF;

 r:=rcat_private.inventory_submit_stocktake(manager,t,s,take,975.500,
  'Physical stocktake morning shift');
 IF r->>'state'<>'submitted' OR r->>'replayed'<>'false'
 THEN RAISE EXCEPTION 'Count was not submitted: %',r; END IF;
 r:=rcat_private.inventory_submit_stocktake(manager,t,s,take,975.500,
  'Physical stocktake morning shift');
 IF r->>'replayed'<>'true' THEN
   RAISE EXCEPTION 'Count replay was not safe'; END IF;
 bad:=false;
 BEGIN
   PERFORM rcat_private.inventory_submit_stocktake(owner,t,s,take,900,
     'Attempt overwrite count');
 EXCEPTION WHEN SQLSTATE 'P0007' THEN bad:=true; END;
 IF NOT bad THEN RAISE EXCEPTION 'Submitted quantity overwritten'; END IF;

 bad:=false;
 BEGIN
   PERFORM rcat_private.inventory_review_stocktake(manager,t,s,take,true);
 EXCEPTION WHEN SQLSTATE 'P0007' THEN bad:=true; END;
 IF NOT bad THEN RAISE EXCEPTION 'Counter self-approved stocktake'; END IF;
 r:=rcat_private.inventory_review_stocktake(owner,t,s,take,true);
 IF r->>'state'<>'approved' OR r->>'movementId' IS NULL OR
   r->>'replayed'<>'false' THEN
   RAISE EXCEPTION 'Independent approver failed to post ledger: %',r; END IF;
 r:=rcat_private.inventory_review_stocktake(owner,t,s,take,true);
 IF r->>'replayed'<>'true' THEN
   RAISE EXCEPTION 'Approval retry posted again'; END IF;
 list:=rcat_private.inventory_stocktake_list(manager,t,s);
 IF jsonb_array_length(list->'stocktakes')<>1
   OR (list#>>'{stocktakes,0,countedOnHand}')::numeric<>975.500
 THEN RAISE EXCEPTION 'Stocktake list not scoped or incorrect'; END IF;
 r:=rcat_private.inventory_snapshot(owner,t,s);
 IF (SELECT (v->>'onHand')::numeric FROM jsonb_array_elements(r->'items') v
     WHERE v->>'itemId'=item::text)<>975.500
    OR jsonb_array_length(r->'recentMovements')<>2
 THEN RAISE EXCEPTION 'Approved adjustment did not reconcile'; END IF;

 -- A balance may change and return to its original numeric value. Using a
 -- monotonic stock_version detects this write-then-return stale count.
 r:=rcat_private.inventory_open_stocktake(owner,t,s,item,
   'cccccccc-cccc-4ccc-8ccc-cccccccc0014');
 stale_take:=(r->>'stocktakeId')::uuid;
 PERFORM rcat_private.inventory_submit_stocktake(manager,t,s,
   stale_take,960.000,'Physical count before a receipt');
 PERFORM rcat_private.inventory_move(owner,t,s,item,
   'cccccccc-cccc-4ccc-8ccc-cccccccc0015','receipt',10,
   'Receipt while count in progress');
 PERFORM rcat_private.inventory_move(owner,t,s,item,
   'cccccccc-cccc-4ccc-8ccc-cccccccc0016','adjustment',-10,
   'Return to previous balance');
 bad:=false;
 BEGIN
   PERFORM rcat_private.inventory_review_stocktake(owner,t,s,stale_take,true);
 EXCEPTION WHEN SQLSTATE 'P0006' THEN bad:=true; END;
 IF NOT bad THEN RAISE EXCEPTION 'Stale stocktake approved'; END IF;
 r:=rcat_private.inventory_review_stocktake(owner,t,s,stale_take,false);
 IF r->>'state'<>'rejected' THEN RAISE EXCEPTION 'Cannot reject stale count'; END IF;

 r:=rcat_private.inventory_open_stocktake(owner,t,s,item_other,
   'cccccccc-cccc-4ccc-8ccc-cccccccc0017');
 reject_take:=(r->>'stocktakeId')::uuid;
 PERFORM rcat_private.inventory_submit_stocktake(owner,t,s,
   reject_take,0,'Count verified as zero');
 bad:=false;
 BEGIN
   PERFORM rcat_private.inventory_review_stocktake(owner,t,s,reject_take,true);
 EXCEPTION WHEN SQLSTATE 'P0007' THEN bad:=true; END;
 IF NOT bad THEN RAISE EXCEPTION 'Owner self-approved'; END IF;
 r:=rcat_private.inventory_review_stocktake(manager,t,s,reject_take,true);
 IF r->>'movementId' IS NOT NULL THEN
    RAISE EXCEPTION 'Zero delta created movement'; END IF;

 -- An open count must never disappear from the reviewer queue when
 -- more than 40 recent completed stocktakes exist.
 r:=rcat_private.inventory_open_stocktake(owner,t,s,item_other,
   pg_catalog.gen_random_uuid());
 reject_take:=(r->>'stocktakeId')::uuid;
 FOR i IN 1..45 LOOP
   r:=rcat_private.inventory_open_stocktake(owner,t,s,item,
     pg_catalog.gen_random_uuid());
   PERFORM rcat_private.inventory_submit_stocktake(manager,t,s,
     (r->>'stocktakeId')::uuid,975.500,'Historical completed count');
   PERFORM rcat_private.inventory_review_stocktake(owner,t,s,
     (r->>'stocktakeId')::uuid,false);
 END LOOP;
 list:=rcat_private.inventory_stocktake_list(owner,t,s);
 IF jsonb_array_length(list->'stocktakes')<>41 OR NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(list->'stocktakes') v
   WHERE (v->>'stocktakeId')::uuid=reject_take AND v->>'state'='open'
 ) THEN
   RAISE EXCEPTION 'Pending stocktake was hidden behind completed history';
 END IF;

 bad:=false;
 BEGIN
   PERFORM rcat_private.inventory_open_stocktake(owner,other_t,other_s,item,
    'cccccccc-cccc-4ccc-8ccc-cccccccc0018');
 EXCEPTION WHEN insufficient_privilege THEN bad:=true; END;
 IF NOT bad THEN RAISE EXCEPTION 'Cross-tenant stocktake allowed'; END IF;
 bad:=false;
 BEGIN SELECT 1 FROM rcat.inventory_stocktakes LIMIT 1;
 EXCEPTION WHEN insufficient_privilege THEN bad:=true; END;
 IF NOT bad THEN RAISE EXCEPTION 'Auth role read raw stocktake table'; END IF;

 PERFORM set_config('test.stocktake_id',take::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE v_take uuid:=current_setting('test.stocktake_id')::uuid;
BEGIN
 IF (SELECT count(*) FROM rcat.inventory_movements WHERE stocktake_id=v_take)<>1
  OR (SELECT delta FROM rcat.inventory_movements WHERE stocktake_id=v_take)<>-24.625
  OR (SELECT count(*) FROM rcat.audit_events
      WHERE action='inventory.stocktake.approved' AND subject_id=v_take)<>1
  OR (SELECT stock_version FROM rcat.inventory_items i JOIN
     rcat.inventory_stocktakes s ON s.item_id=i.id
     WHERE s.id=v_take)<2
 THEN RAISE EXCEPTION 'Stocktake ledger/audit/version invariants failed'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: dual approval, immutable counting, one-post retry, stale version CAS, tenant isolation and no-zero movement'
