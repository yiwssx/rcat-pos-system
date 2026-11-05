import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";

/**
 * G4 concurrency qualification, NOT a production benchmark.
 *
 * Runs only against the disposable PostgreSQL 16 GitHub Actions database.
 * Each promise takes a separate pg connection and an isolated transaction;
 * a single connection would serialize queries and mask real row-lock races.
 *
 * No payments, merchant secrets, public customers, or external endpoints.
 */
const { Pool } = pg;
const concurrency = Number(process.env.RCAT_LOAD_CLIENTS ?? "24");
const host = process.env.PGHOST ?? "";
if (
  process.env.CI !== "true" ||
  process.env.PGDATABASE !== "rcat_ci_test" ||
  !["127.0.0.1", "localhost", "::1"].includes(host) ||
  !Number.isInteger(concurrency) ||
  concurrency < 8 ||
  concurrency > 64
) {
  throw new Error("Load regression requires explicit CI fixtures, loopback PostgreSQL and 8–64 clients");
}

const pool = new Pool({
  max: Math.min(concurrency, 16),
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 1000,
  statement_timeout: 35000,
});
const tenantId = randomUUID();
const storeId = randomUUID();
const ownerId = randomUUID();
const managerId = randomUUID();
const session = randomBytes(32);
const managerSession = randomBytes(32);
const visit = randomBytes(32);
const testSlug = "g4-load-" + tenantId.slice(0, 12);
const sql = {
  guest: "SELECT rcat_private.place_guest_order($1::bytea,$2::text,$3::jsonb) AS data",
  transition:
    "SELECT rcat_private.transition_merchant_order($1::bytea,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text) AS data",
  exceptionRequest:
    "SELECT rcat_private.inventory_request_exception_return($1::bytea,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::numeric,$8::text,$9::text) AS data",
  exceptionReview:
    "SELECT rcat_private.inventory_review_exception_return($1::bytea,$2::uuid,$3::uuid,$4::uuid,$5::boolean) AS data",
};

async function authenticated(query, values) {
  const client = await pool.connect();
  let active = false;
  try {
    await client.query("BEGIN");
    active = true;
    await client.query("SET LOCAL ROLE rcat_auth");
    await client.query("SET LOCAL lock_timeout = '20s'");
    const result = await client.query(query, values);
    await client.query("COMMIT");
    active = false;
    return result.rows[0]?.data;
  } catch (error) {
    if (active) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function privileged(query, values = []) {
  const result = await pool.query(query, values);
  return result.rows;
}

async function createFixture() {
  // Seed with the CI superuser, then use the restricted auth role for
  // all business operations (SECURITY DEFINER, Session and membership).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO rcat.tenants(id,slug,display_name) VALUES($1,$2,$3)",
      [tenantId, testSlug, "G4 isolated concurrent order fixture"],
    );
    await client.query(
      "INSERT INTO rcat.stores(id,tenant_id,slug,display_name) VALUES($1,$2,$3,$4)",
      [storeId, tenantId, "load-store", "G4 load store"],
    );
    for (const [id, role] of [[ownerId, "owner"], [managerId, "manager"]]) {
      await client.query(
        "INSERT INTO rcat.users(id,email,password_hash) VALUES($1,$2,$3)",
        [id, "ci-load-" + id + "@test.invalid", "CI-ONLY-NO-LOGIN"],
      );
      await client.query(
        "INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [tenantId, id, role],
      );
    }
    for (const [id, token] of [[ownerId, session], [managerId, managerSession]]) {
      await client.query(
        "INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at) VALUES($1,$2,$3,now()+interval '2 hours')",
        [id, token, randomBytes(32)],
      );
    }
    await client.query("SET LOCAL ROLE rcat_auth");
    const call = async (query, params) =>
      (await client.query(query, params)).rows[0]?.data;
    const catId = (
      await call(
        "SELECT rcat_private.add_menu_category($1,$2,$3,$4,$5) AS data",
        [session, tenantId, storeId, "load-food", "Concurrent kitchen"],
      )
    );
    const productId = await call(
      "SELECT rcat_private.add_menu_product($1,$2,$3,$4,$5) AS data",
      [session, tenantId, storeId, catId, "Load-test bowl", 12000],
    );
    const ingredientA = await call(
      "SELECT rcat_private.inventory_create_item($1,$2,$3,$4,$5,$6::numeric) AS data",
      [session, tenantId, storeId, "G4 rice", "g", "0"],
    );
    const ingredientB = await call(
      "SELECT rcat_private.inventory_create_item($1,$2,$3,$4,$5,$6::numeric) AS data",
      [session, tenantId, storeId, "G4 broth", "ml", "0"],
    );
    for (const [ingredientId, amount] of [[ingredientA, "10.000"], [ingredientB, "7.000"]]) {
      await call(
        "SELECT rcat_private.inventory_move($1,$2,$3,$4,$5,$6,$7::numeric,$8) AS data",
        [session, tenantId, storeId, ingredientId, randomUUID(), "receipt", amount, "G4 ephemeral ingredient stock"],
      );
      await call(
        "SELECT rcat_private.inventory_set_recipe($1,$2,$3,$4,$5,$6::numeric) AS data",
        [session, tenantId, storeId, productId, ingredientId, "1.000"],
      );
    }
    await call(
      "SELECT rcat_private.inventory_set_product_tracking($1,$2,$3,$4,$5) AS data",
      [session, tenantId, storeId, productId, true],
    );
    const tableId = await call(
      "SELECT rcat_private.create_ordering_table($1,$2,$3,$4) AS data",
      [session, tenantId, storeId, "Concurrent table"],
    );
    await call(
      "SELECT visit_id AS data FROM rcat_private.rotate_ordering_visit($1,$2,$3,$4,$5)",
      [session, tenantId, storeId, tableId, visit],
    );
    await client.query("COMMIT");
    return { productId, ingredientA, ingredientB, tableId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const place = (key, cart, token = visit) =>
  authenticated(sql.guest, [token, key, JSON.stringify(cart)]);
const transition = (id, expected, next, digest = session, t = tenantId, s = storeId) =>
  authenticated(sql.transition, [digest, t, s, id, expected, next]);
const requestReturn = (orderId, itemId, quantity) =>
  authenticated(sql.exceptionRequest, [
    session, tenantId, storeId, orderId, itemId, randomUUID(),
    quantity, "unused_unopened", "Unused sealed CI ingredient, physically verified",
  ]);
const reviewReturn = (requestId) =>
  authenticated(sql.exceptionReview, [
    managerSession, tenantId, storeId, requestId, true,
  ]);

async function measured(fn) {
  const started = performance.now();
  try {
    return { ok: true, value: await fn(), ms: performance.now() - started };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? "unknown",
      error: error?.message ?? String(error),
      ms: performance.now() - started,
    };
  }
}

function quantile(values, percentile) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return Math.round(ordered[Math.ceil((ordered.length * percentile) / 100) - 1]);
}

function summary(label, results) {
  const durations = results.map((x) => x.ms);
  const report = {
    scenario: label,
    operations: results.length,
    success: results.filter((x) => x.ok).length,
    failures: results.filter((x) => !x.ok).reduce((acc, x) => {
      acc[x.code] = (acc[x.code] ?? 0) + 1;
      return acc;
    }, {}),
    p50ms: quantile(durations, 50),
    p95ms: quantile(durations, 95),
    maxMs: Math.round(Math.max(...durations)),
  };
  console.log(JSON.stringify(report));
  return report;
}

function assertExpectedFailures(results, allowed) {
  const unexpected = results.filter((x) => !x.ok && !allowed.includes(x.code));
  assert.deepEqual(
    unexpected.map((x) => ({ code: x.code, error: x.error })),
    [],
    "Unexpected PostgreSQL failure (deadlock, timeout, role leak or SQL error)",
  );
}

async function counts(query, params) {
  return Number((await privileged(query, params))[0].total);
}

async function inventoryState(a, b) {
  const result = await privileged(
    "SELECT id,on_hand::text AS on_hand FROM rcat.inventory_items WHERE tenant_id=$1 AND store_id=$2 AND id=ANY($3::uuid[])",
    [tenantId, storeId, [a, b]],
  );
  return new Map(result.map((row) => [row.id, row.on_hand]));
}

async function verifyStock(a, b, expectedA, expectedB) {
  const stock = await inventoryState(a, b);
  assert.equal(stock.get(a), expectedA, "First ingredient stock mismatch");
  assert.equal(stock.get(b), expectedB, "Second ingredient stock mismatch");
}

async function run() {
  const started = performance.now();
  const { productId, ingredientA, ingredientB, tableId } = await createFixture();
  const cart = {
    items: [{ productId, quantity: 1, optionIds: [] }],
  };
  const key = "same-click-" + randomUUID();

  // Multiple checkout retries, same visit/key/cart, many distinct database
  // sessions: only one committed Order and one submission Outbox event.
  const repeated = await Promise.all(
    Array.from({ length: concurrency }, () => measured(() => place(key, cart))),
  );
  summary("simultaneous idempotent guest checkout", repeated);
  assertExpectedFailures(repeated, []);
  const one = new Set(repeated.map((r) => r.value.orderId));
  assert.equal(one.size, 1, "Duplicate guest checkout created more than one Order");
  assert.equal(repeated.filter((r) => r.value.replayed === false).length, 1);
  assert.equal(repeated.filter((r) => r.value.replayed === true).length, concurrency - 1);
  assert.ok(repeated.every((r) =>
    r.value.amountSatang === 12000 &&
    r.value.paymentState === "not_requested" &&
    r.value.status === "submitted",
  ));
  const altered = {
    items: [{ productId, quantity: 2, optionIds: [] }],
  };
  const conflicting = await measured(() => place(key, altered));
  assert.equal(conflicting.code, "23505", "Different cart reused same checkout key");

  // Checkout does not reserve ingredient stock. All guest submissions should
  // commit even though only seven orders can be accepted.
  const orderRuns = await Promise.all(
    Array.from({ length: concurrency }, (_, i) =>
      measured(() => place("separate-order-" + i + "-" + randomUUID(), cart)),
    ),
  );
  summary("unique concurrent guest orders", orderRuns);
  assertExpectedFailures(orderRuns, []);
  const orderIds = orderRuns.map((x) => x.value.orderId);
  assert.equal(new Set(orderIds).size, concurrency);
  const checkoutCount = await counts(
    "SELECT count(*)::int AS total FROM rcat.orders WHERE tenant_id=$1",
    [tenantId],
  );
  assert.equal(checkoutCount, concurrency + 1);
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.order_outbox_events WHERE tenant_id=$1 AND event_type='order.submitted'",
    [tenantId],
  ), concurrency + 1, "Checkout retry duplicated durable outbox event");

  // Two shared ingredients, 10 and 7 units, each Order needs 1 of each:
  // one winner per scarce unit, all losing Order/status/outbox/ledger writes
  // roll back. The first ingredient must not be decremented on second shortage.
  const accepts = await Promise.all(
    orderIds.map((id) => measured(() =>
      transition(id, "submitted", "accepted"))),
  );
  summary("contended multi-ingredient merchant acceptance", accepts);
  assertExpectedFailures(accepts, ["P0004"]);
  const winners = accepts
    .map((result, i) => ({ result, id: orderIds[i] }))
    .filter((x) => x.result.ok)
    .map((x) => x.id);
  assert.equal(winners.length, 7, "Shared ingredient oversold or valid Orders lost");
  assert.equal(accepts.filter((r) => r.code === "P0004").length, concurrency - 7);
  await verifyStock(ingredientA, ingredientB, "3.000", "0.000");
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.inventory_order_allocations WHERE tenant_id=$1",
    [tenantId],
  ), 14, "Failed acceptance leaked allocations");
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.order_outbox_events WHERE tenant_id=$1 AND status='accepted'",
    [tenantId],
  ), 7, "Failed acceptance leaked status Outbox");
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.orders WHERE tenant_id=$1 AND status='accepted'",
    [tenantId],
  ), 7, "Accepted Order count diverged from stock");

  // Two devices cancel each of three Orders at the same time.
  // Exactly one per Order wins the compare-and-set transition.
  const cancellations = await Promise.all(
    winners.slice(0, 3).flatMap((id) => [
      measured(() => transition(id, "accepted", "cancelled")),
      measured(() => transition(id, "accepted", "cancelled")),
    ]),
  );
  summary("duplicate cancellation from multiple merchant devices", cancellations);
  assertExpectedFailures(cancellations, ["P0001"]);
  assert.equal(cancellations.filter((x) => x.ok).length, 3);
  assert.equal(cancellations.filter((x) => x.code === "P0001").length, 3);
  await verifyStock(ingredientA, ingredientB, "6.000", "3.000");
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.inventory_movements WHERE tenant_id=$1 AND kind='order_return'",
    [tenantId],
  ), 6, "Duplicate cancellation returned stock twice");

  // Race two accept attempts for one replenished submitted Order.
  const recoveredId = orderIds.find((id) => !winners.includes(id));
  assert.ok(recoveredId);
  const retryAcceptance = await Promise.all([
    measured(() => transition(recoveredId, "submitted", "accepted")),
    measured(() => transition(recoveredId, "submitted", "accepted")),
  ]);
  summary("duplicate merchant acceptance on replenished stock", retryAcceptance);
  assertExpectedFailures(retryAcceptance, ["P0001"]);
  assert.equal(retryAcceptance.filter((x) => x.ok).length, 1);
  assert.equal(retryAcceptance.filter((x) => x.code === "P0001").length, 1);
  await verifyStock(ingredientA, ingredientB, "5.000", "2.000");

  // Independent manager approval of physically unused material is safe
  // under repeated simultaneous "approve" requests.
  const preparingOrder = winners[3];
  await transition(preparingOrder, "accepted", "preparing");
  const request = await requestReturn(preparingOrder, ingredientA, "0.250");
  assert.equal(request.state, "pending");
  const approvals = await Promise.all([
    measured(() => reviewReturn(request.requestId)),
    measured(() => reviewReturn(request.requestId)),
  ]);
  summary("duplicate independent exception stock approval", approvals);
  assertExpectedFailures(approvals, []);
  assert.equal(approvals.filter((x) => x.value.replayed === false).length, 1);
  assert.equal(approvals.filter((x) => x.value.replayed === true).length, 1);
  await verifyStock(ingredientA, ingredientB, "5.250", "2.000");
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.inventory_movements WHERE tenant_id=$1 AND kind='exception_return'",
    [tenantId],
  ), 1, "Duplicate exception approval created two inventory credits");

  // Forged tenant/store credentials cannot drive an existing Order.
  const denied = await measured(() =>
    transition(recoveredId, "accepted", "cancelled", session, randomUUID(), randomUUID()));
  assert.equal(denied.code, "42501", "Cross-tenant Order transition accepted");

  // After rotating the visit QR, no stale client may create an Order,
  // even if many devices still hold the previous visit token.
  await authenticated(
    "SELECT visit_id AS data FROM rcat_private.rotate_ordering_visit($1,$2,$3,$4,$5)",
    [session, tenantId, storeId, tableId, randomBytes(32)],
  );
  const stale = await Promise.all(
    Array.from({ length: concurrency }, (_, i) =>
      measured(() => place("stale-visit-" + i + "-" + randomUUID(), cart))),
  );
  summary("revoked QR token concurrency", stale);
  assertExpectedFailures(stale, ["42501"]);
  assert.equal(stale.filter((x) => x.code === "42501").length, concurrency);
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.orders WHERE tenant_id=$1",
    [tenantId],
  ), concurrency + 1, "Revoked visit created Orders");

  // Final invariant: no external financial confirmation; status transitions,
  // Outbox, allocations and ledger move together, never into payment success.
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.orders WHERE tenant_id=$1 AND payment_state<>'not_requested'",
    [tenantId],
  ), 0);
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.order_outbox_events WHERE tenant_id=$1 AND event_type='order.status.changed'",
    [tenantId],
  ), 12, "Duplicate/rejected transitions leaked Outbox");
  assert.equal(await counts(
    "SELECT count(*)::int AS total FROM rcat.inventory_order_allocations WHERE tenant_id=$1 AND returned_at IS NOT NULL",
    [tenantId],
  ), 6, "Frozen cancellation allocations not marked returned exactly once");
  console.log(JSON.stringify({
    result: "PASS",
    ciOnly: true,
    concurrency,
    totalElapsedMs: Math.round(performance.now() - started),
    label: "CI database contention test; not live-traffic benchmark or production SLO",
  }));
}

try {
  await run();
} catch (error) {
  process.exitCode = 1;
  console.error("G4 concurrency regression FAILED", {
    code: error?.code ?? "assertion",
    message: error?.message ?? String(error),
  });
} finally {
  await pool.end();
}
