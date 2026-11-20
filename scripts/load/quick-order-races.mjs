// C focused concurrency proof. Existing ephemeral CI database only.
// No host, Production, Payment or arbitrary environment override.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

if (
  process.env.CI !== "true" ||
  process.env.PGDATABASE !== "rcat_ci_test" ||
  !["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST)
) {
  throw new Error("Quick Order race test requires disposable loopback CI");
}
const { Pool } = pg;
const db = new Pool({ max: 16 });
const tenant = "00000000-0000-4000-8000-000000000001";
const store = "20000000-0000-4000-8000-000000000001";
const staff = randomBytes(32);
const guest = randomBytes(32);
const suffix = randomUUID().slice(0, 10);
const query = async (sql, params) => (await db.query(sql, params)).rows[0];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let blocker;

try {
  await query(
    `INSERT INTO rcat_private.auth_sessions(
      user_id,token_digest,csrf_digest,expires_at
     ) VALUES('10000000-0000-4000-8000-000000000001',$1,$2,
              clock_timestamp()+interval '2 hours')`,
    [staff, randomBytes(32)],
  );
  const mode = await query(
    "SELECT rcat_private.store_service_mode_snapshot($1,$2,$3) AS data",
    [staff, tenant, store],
  );
  if (mode.data.serviceMode !== "quick") {
    await query(
      "SELECT rcat_private.set_store_service_mode($1,$2,$3,'quick',$4) AS data",
      [staff, tenant, store, mode.data.revision],
    );
  }
  await query(
    "SELECT rcat_private.set_store_ordering_enabled($1,$2,$3,true)",
    [staff, tenant, store],
  );
  const qr = await query(
    "SELECT rcat_private.rotate_store_qr($1,$2,$3) AS data",
    [staff, tenant, store],
  );
  const opened = await query(
    "SELECT rcat_private.open_printed_store_qr($1,$2,$3,$4) AS data",
    [tenant, store, qr.data.publicId, guest],
  );
  assert.equal(opened.data.open, true);
  const cat = await query(
    "SELECT rcat_private.add_menu_category($1,$2,$3,$4,$5) AS id",
    [staff, tenant, store, "race-" + suffix, "Quick Race CI"],
  );
  const product = await query(
    "SELECT rcat_private.add_menu_product($1,$2,$3,$4,$5,$6) AS id",
    [staff, tenant, store, cat.id, "Race coffee", 6500],
  );
  const payload = {
    orderedBy: "Race CI",
    deliverTo: "Counter",
    items: [{ productId: product.id, quantity: 1, optionIds: [], note: "" }],
  };
  const submit = (key, target = null) =>
    query(
      "SELECT rcat_private.quick_order_submit($1,$2,$3::jsonb,$4::uuid) AS data",
      [guest, key, JSON.stringify(payload), target],
    );
  const initial = (await submit("quick-race-initial-" + suffix)).data;
  assert.equal(initial.action, "created");

  // Real multi-connection same-key concurrency: only one add succeeds,
  // all others replay without duplicate items, stock or SSE events.
  const retryKey = "quick-race-retry-" + suffix;
  const sameKey = await Promise.all(
    Array.from({ length: 8 }, () => submit(retryKey, initial.orderId)),
  );
  assert.equal(sameKey.filter((x) => !x.data.replayed).length, 1);
  assert.equal(sameKey.filter((x) => x.data.replayed).length, 7);
  const afterRetry = await query(
    "SELECT count(*)::int AS n FROM rcat.order_items WHERE order_id=$1",
    [initial.orderId],
  );
  assert.equal(afterRetry.n, 2);

  await query(
    "SELECT rcat_private.transition_merchant_order($1,$2,$3,$4,'submitted','accepted') AS data",
    [staff, tenant, store, initial.orderId],
  );

  // Hold the parent Store row, then queue an accepted Guest append AND
  // the explicit Merchant Preparing transition on separate DB sessions.
  // Both must use Store -> Order locks, preventing deadlocks/lost writes.
  blocker = await db.connect();
  await blocker.query("BEGIN");
  await blocker.query(
    "SELECT 1 FROM rcat.stores WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tenant, store],
  );
  const attempted = submit("quick-race-vs-prep-" + suffix, initial.orderId);
  const cooking = query(
    "SELECT rcat_private.transition_merchant_order($1,$2,$3,$4,'accepted','preparing') AS data",
    [staff, tenant, store, initial.orderId],
  );
  await sleep(75);
  await blocker.query("COMMIT");
  blocker.release();
  blocker = null;
  const [addition, preparation] = await Promise.all([attempted, cooking]);
  assert.equal(preparation.data.status, "preparing");
  const result = addition.data;
  const original = await query(
    "SELECT status,amount_satang FROM rcat.orders WHERE id=$1",
    [initial.orderId],
  );
  assert.equal(original.status, "preparing");
  if (result.action === "appended") {
    assert.equal(result.orderId, initial.orderId);
    assert.equal(Number(original.amount_satang), 19500);
  } else {
    assert.equal(result.action, "new_after_cutoff");
    assert.notEqual(result.orderId, initial.orderId);
    assert.equal(Number(original.amount_satang), 13000);
  }
  const retry = (await submit("quick-race-vs-prep-" + suffix, initial.orderId)).data;
  assert.equal(retry.replayed, true);
  assert.equal(retry.orderId, result.orderId);

  const ownerList = (await query(
    "SELECT rcat_private.quick_order_my_orders($1) AS data",
    [guest],
  )).data.orders;
  assert.ok(ownerList.some((x) => x.orderId === initial.orderId));
  assert.ok(ownerList.some((x) => x.orderId === result.orderId));

  console.log(JSON.stringify({
    case: "Quick same-key concurrency and Accepted→Preparing add-on race",
    result: "PASS",
    outcomes: {
      idempotentConcurrentRequests: 8,
      preparingTransition: preparation.data.status,
      addOnAction: result.action,
    },
    ownerOnly: true,
    paymentVerified: false,
  }));
} finally {
  if (blocker) {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
  }
  await db.end();
}
