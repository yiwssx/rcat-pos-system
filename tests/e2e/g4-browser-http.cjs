// G4 CI-only real HTTP burst + Chromium ordering/merchant browser E2E.
// Uses the existing ephemeral rcat_ci_test fixtures. No live payment or external app.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { setTimeout: delay } = require("node:timers/promises");
const { Pool } = require("pg");
const { chromium, devices } = require("playwright");

if (
  process.env.CI !== "true" ||
  process.env.PGDATABASE !== "rcat_ci_test" ||
  !["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST)
) throw new Error("G4 HTTP/browser E2E only runs against loopback ephemeral CI PostgreSQL");

const apiPort = 3000; // Angular /api proxy files target this port.
const customerPort = 31947;
const merchantPort = 31948;
const apiOrigin = "http://127.0.0.1:" + apiPort;
const customer = "https://127.0.0.1:" + customerPort;
const merchant = "https://127.0.0.1:" + merchantPort;
const tenant = "00000000-0000-4000-8000-000000000001";
const store = "20000000-0000-4000-8000-000000000001";
const orderScope = "/api/tenants/" + tenant + "/stores/" + store;
const children = [];
const db = new Pool({ max: 3 });
let browser;

function start(name, command, args, env = {}) {
  const p = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ring = [];
  for (const stream of [p.stdout, p.stderr]) {
    stream.on("data", (chunk) => {
      ring.push(String(chunk));
      if (ring.length > 100) ring.shift();
    });
  }
  const service = { name, process: p, ring };
  children.push(service);
  return service;
}

async function untilHealthy(url, service, timeoutMs = 160000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (service.process.exitCode !== null) {
      throw new Error(service.name + " exited: " + service.ring.join("").slice(-5000));
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch { /* starting */ }
    await delay(400);
  }
  throw new Error("Timeout waiting for " + service.name + "\n" + service.ring.join("").slice(-4000));
}

async function post(url, data, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { Origin: customer, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(25000),
  });
}

function percentile(numbers, pct) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * pct / 100) - 1]);
}
async function burst(tasks, name, expectedStatus = 201) {
  const results = await Promise.all(tasks.map(async (fn) => {
    const start = performance.now();
    try {
      const res = await fn();
      const data = await res.json();
      return { status: res.status, data, ms: performance.now() - start };
    } catch (e) {
      return { status: -1, data: String(e), ms: performance.now() - start };
    }
  }));
  const metrics = {
    scenario: name,
    requests: results.length,
    statuses: results.reduce((map, r) => {
      map[r.status] = (map[r.status] ?? 0) + 1;
      return map;
    }, {}),
    p50ms: percentile(results.map((r) => r.ms), 50),
    p95ms: percentile(results.map((r) => r.ms), 95),
  };
  console.log(JSON.stringify(metrics));
  assert.ok(results.every((r) => r.status === expectedStatus),
    "Unexpected HTTP result in " + name + ": " +
    JSON.stringify(results.filter((r) => r.status !== expectedStatus).slice(0, 3)));
  return results;
}

async function merchantLoginRequest(context) {
  const res = await context.request.post(merchant + "/api/auth/login", {
    headers: { Origin: merchant },
    data: { email: "a@test.invalid", password: "example-password-2026" },
  });
  assert.equal(res.status(), 200, await res.text());
  const cookies = await context.cookies(merchant);
  assert.ok(cookies.some((x) => x.name === "__Host-rcat_session"), "Merchant browser did not retain session cookie");
  assert.ok(cookies.some((x) => x.name === "__Host-rcat_csrf"), "Merchant browser did not retain CSRF cookie");
}

async function apiSetup() {
  const login = await fetch(merchant + "/api/auth/login", {
    method: "POST",
    headers: { Origin: merchant, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "a@test.invalid", password: "example-password-2026" }),
  });
  assert.equal(login.status, 200, await login.text());
  const raw = login.headers.getSetCookie().map((value) => value.split(";")[0]);
  const csrf = raw.find((v) => v.startsWith("__Host-rcat_csrf="));
  assert.ok(csrf);
  const headers = {
    Origin: merchant,
    "Content-Type": "application/json",
    Cookie: raw.join("; "),
    "X-CSRF-Token": csrf.split("=")[1],
  };
  const suffix = randomUUID().slice(0, 12);
  const catRes = await fetch(merchant + orderScope + "/catalog/categories", {
    method: "POST", headers,
    body: JSON.stringify({ slug: "g4-e2e-" + suffix, name: "G4 E2E QA" }),
  });
  assert.equal(catRes.status, 201, await catRes.clone().text());
  const { categoryId } = await catRes.json();
  const name = "G4 QA bowl " + suffix;
  const itemRes = await fetch(merchant + orderScope + "/catalog/products", {
    method: "POST", headers,
    body: JSON.stringify({ categoryId, name, priceSatang: 12500 }),
  });
  assert.equal(itemRes.status, 201, await itemRes.clone().text());
  const { productId } = await itemRes.json();
  const tableRes = await fetch(merchant + orderScope + "/tables", {
    method: "POST", headers,
    body: JSON.stringify({ label: "G4 " + suffix }),
  });
  assert.equal(tableRes.status, 201, await tableRes.clone().text());
  const { tableId } = await tableRes.json();
  async function rotate() {
    const res = await fetch(merchant + orderScope + "/tables/" + tableId + "/rotate", {
      method: "POST", headers,
    });
    assert.equal(res.status, 201, await res.clone().text());
    const body = await res.json();
    const uri = new URL(body.orderingUrl);
    assert.equal(uri.pathname, "/order");
    const token = decodeURIComponent(uri.hash.slice("#token=".length));
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    return token;
  }
  return { name, productId, tableId, token: await rotate(), rotate };
}

async function browserFlow(fixture) {
  browser = await chromium.launch({ headless: true });
  const guestContext = await browser.newContext({
    ...devices["iPhone 13"],
    browserName: undefined,
    baseURL: customer,
    ignoreHTTPSErrors: true,
  });
  const merchantContext = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    baseURL: merchant,
    ignoreHTTPSErrors: true,
  });
  const secondContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: merchant,
    ignoreHTTPSErrors: true,
  });
  const guest = await guestContext.newPage();
  const board = await merchantContext.newPage();
  const second = await secondContext.newPage();

  try {
    // Open a genuine table QR fragment and confirm it is scrubbed before
    // a browser history / screenshot / URL could accidentally expose it.
    await guest.goto(customer + "/order#token=" + fixture.token);
    await guest.locator(".guest-product", { hasText: fixture.name }).waitFor();
    assert.equal(new URL(guest.url()).hash, "", "QR token leaked into URL after load");
    assert.ok(await guest.getByText("ยังไม่มีการชำระเงินผ่าน PromptPay").count());

    // iPhone offline: do not submit an Order or silently mutate cart;
    // reconnect and submit through the visible Angular button.
    await guest.locator(".guest-product", { hasText: fixture.name })
      .getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
    const checkout = guest.getByRole("button", { name: /ยืนยันส่งคำสั่งซื้อ/ });
    await checkout.waitFor();
    await guestContext.setOffline(true);
    await guest.evaluate(() => window.dispatchEvent(new Event("offline")));
    await guest.waitForTimeout(150);
    assert.ok(await checkout.isDisabled(), "Offline customer could submit checkout");
    await guestContext.setOffline(false);
    await guest.evaluate(() => window.dispatchEvent(new Event("online")));
    await checkout.click();
    await guest.waitForURL("**/order/track", { timeout: 20000 });
    await guest.getByText("Payment: not_requested").waitFor();
    const orderIdPrefix = (await guest.locator(".guest-track-id").innerText())
      .match(/[a-f0-9]{8}/i)?.[0];
    assert.ok(orderIdPrefix, "Customer tracking page missing Order ID");
    assert.ok((await guest.locator(".guest-order-state").innerText()).length > 0);

    // Two real independent merchant browser contexts, each with its own
    // HttpOnly session, CSRF cookie and SSE/periodic order board.
    await Promise.all([
      merchantLoginRequest(merchantContext),
      merchantLoginRequest(secondContext),
    ]);
    const route = merchant + "/orders/" + tenant + "/" + store;
    await Promise.all([board.goto(route), second.goto(route)]);
    const selector = 'article[aria-label^="ออเดอร์ ' + orderIdPrefix + '"]';
    await board.locator(selector).waitFor({ timeout: 20000 });
    await second.locator(selector).waitFor({ timeout: 20000 });
    await board.locator(selector).getByRole("button", { name: "รับออเดอร์" }).click();
    await board.locator(selector).getByText("รับออเดอร์แล้ว").waitFor({ timeout: 20000 });
    await second.locator(selector).getByText("รับออเดอร์แล้ว").waitFor({ timeout: 20000 });

    // A foreground refresh should pick up the new status on the guest tab
    // without claiming the Order has been paid or losing the tracking secret.
    await guest.getByRole("button", { name: "ตรวจสถานะล่าสุด" }).click();
    await guest.locator(".guest-order-state").getByText("รับออเดอร์แล้ว").waitFor({ timeout: 20000 });
    assert.ok(await guest.getByText("Payment: not_requested").isVisible(),
      "Customer tracking did not retain explicit unverified payment state");

    // Expire the first merchant session with real logout + CSRF, then
    // refresh the browser to prove stale tab access is no longer authorized.
    const stored = await merchantContext.cookies(merchant);
    const csrf = stored.find((c) => c.name === "__Host-rcat_csrf")?.value;
    assert.ok(csrf);
    const logout = await merchantContext.request.post(merchant + "/api/auth/logout", {
      headers: { Origin: merchant, "X-CSRF-Token": csrf },
    });
    assert.equal(logout.status(), 204, await logout.text());
    await board.reload();
    await board.getByText("เซสชันหมดอายุ").waitFor({ timeout: 20000 });

    console.log(JSON.stringify({
      browser: "Chromium", viewport: "mobile customer + desktop/mobile merchant",
      result: "PASS",
      scenarios: ["QR URL scrub", "offline submit block", "tracked checkout",
        "independent merchant tabs", "order status propagation", "expired session denied"],
    }));
  } catch (error) {
    for (const [name, page] of [["guest", guest], ["merchant", board], ["second", second]]) {
      try {
        await page.screenshot({ path: "/tmp/rcat-e2e-" + name + ".png", fullPage: true });
      } catch { /* failure diagnostics are optional */ }
    }
    throw error;
  } finally {
    await Promise.allSettled([
      guestContext.close(), merchantContext.close(), secondContext.close(),
    ]);
  }
}

async function httpLoad(fixture) {
  const batchSize = 24;
  const payload = {
    visitToken: fixture.token,
    items: [{ productId: fixture.productId, quantity: 1, optionIds: [] }],
  };
  const shared = "http-duplicate-" + randomUUID();
  const repeated = await burst(
    Array.from({ length: batchSize }, () =>
      () => post(customer + "/api/guest/orders", payload, { "Idempotency-Key": shared })),
    "24 simultaneous HTTP same-key Orders",
  );
  assert.equal(new Set(repeated.map((x) => x.data.orderId)).size, 1);
  assert.equal(repeated.filter((x) => x.data.replayed === false).length, 1);
  assert.equal(repeated.filter((x) => x.data.replayed === true).length, batchSize - 1);
  assert.ok(repeated.every((x) => x.data.amountSatang === 12500 &&
    x.data.paymentState === "not_requested"));
  const unique = await burst(
    Array.from({ length: batchSize }, () =>
      () => post(customer + "/api/guest/orders", payload, {
        "Idempotency-Key": "http-unique-" + randomUUID(),
      })),
    "24 simultaneous HTTP unique Orders",
  );
  assert.equal(new Set(unique.map((x) => x.data.orderId)).size, batchSize);
  const result = await db.query(
    "SELECT count(*)::int AS total FROM rcat.orders WHERE tenant_id=$1 AND store_id=$2 AND table_id=$3 AND status='submitted'",
    [tenant, store, fixture.tableId],
  );
  // The browser's Order may be accepted, leaving 1 shared + 24 unique submitted.
  assert.equal(result.rows[0].total, batchSize + 1);
  const outbox = await db.query(
    "SELECT count(*)::int AS total FROM rcat.order_outbox_events WHERE tenant_id=$1 AND store_id=$2 AND table_id=$3 AND event_type='order.submitted'",
    [tenant, store, fixture.tableId],
  );
  assert.equal(outbox.rows[0].total, batchSize + 2, "HTTP retries duplicated outbox");
  const oldToken = fixture.token;
  await fixture.rotate();
  const denied = await burst(
    Array.from({ length: 8 }, () =>
      () => post(customer + "/api/guest/orders",
        { ...payload, visitToken: oldToken },
        { "Idempotency-Key": "http-revoked-" + randomUUID() })),
    "8 revoked QR HTTP Order attempts",
    404,
  );
  assert.equal(denied.length, 8);
  const final = await db.query(
    "SELECT count(*)::int AS total FROM rcat.orders WHERE tenant_id=$1 AND store_id=$2 AND table_id=$3",
    [tenant, store, fixture.tableId],
  );
  assert.equal(final.rows[0].total, batchSize + 2);
  console.log("PASS: real HTTP idempotency, scoped Order snapshots, transactional Outbox, revoked QR");
}

async function main() {
  const api = start("NestJS API", process.execPath, ["dist/apps/api/src/main.js"], {
    NODE_ENV: "test",
    PORT: String(apiPort),
    ENABLE_DEVELOPMENT_AUTH: "true",
    AUTH_ALLOWED_ORIGINS: customer + "," + merchant,
    GUEST_ORDER_BASE_URL: customer + "/order",
    AUTH_DATABASE_URL:
      "postgres://rcat_auth_ci:ci-auth-only@127.0.0.1:5432/rcat_ci_test",
    TENANT_DATABASE_URL:
      "postgres://rcat_app_ci:ci-tenant-only@127.0.0.1:5432/rcat_ci_test",
  });
  await untilHealthy(apiOrigin + "/api/health", api);
  const app1 = start("Angular Customer", "pnpm",
    ["exec", "ng", "serve", "customer", "--host", "127.0.0.1", "--port", String(customerPort),
      "--ssl", "--ssl-cert", "/tmp/rcat-g4-cert.pem", "--ssl-key", "/tmp/rcat-g4-key.pem"]);
  const app2 = start("Angular Merchant", "pnpm",
    ["exec", "ng", "serve", "merchant", "--host", "127.0.0.1", "--port", String(merchantPort),
      "--ssl", "--ssl-cert", "/tmp/rcat-g4-cert.pem", "--ssl-key", "/tmp/rcat-g4-key.pem"]);
  await Promise.all([
    untilHealthy(customer + "/order", app1),
    untilHealthy(merchant + "/", app2),
  ]);

  const fixture = await apiSetup();
  await browserFlow(fixture);
  await httpLoad(fixture);
}

(async () => {
  try {
    await main();
    console.log("PASS: G4 customer/mobile merchant Browser E2E and HTTP burst CI");
  } catch (error) {
    console.error("G4 HTTP/browser E2E FAILED:", error?.stack ?? String(error));
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) {
      child.process.kill("SIGTERM");
    }
    await db.end();
  }
})();
