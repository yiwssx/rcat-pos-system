// G4 SSE integrity/capacity on a disposable PostgreSQL + NestJS + HTTPS CI fixture.
// Invoked after the existing end-to-end Order flow; not a production benchmark.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { setTimeout: delay } = require("node:timers/promises");

const MAX_SSE = 32;
const EXTRA_ORDERS = 35;
const SSE_DEADLINE_MS = 14000;

const SECOND_API_PORT = 31949;

const PROXY_PORT = 31955;
async function startProxy() {
  const config = process.cwd() + "/scripts/ops/ci-nginx-sse.conf";
  const log = [];
  const child = spawn("nginx", ["-c", config, "-g", "daemon off;"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const output of [child.stdout, child.stderr]) {
    output.on("data", (data) => {
      log.push(String(data)); if (log.length > 30) log.shift();
    });
  }
  for (let n = 0; n < 45; n += 1) {
    if (child.exitCode !== null) {
      throw new Error("nginx proxy exited: " + log.join("").slice(-2000));
    }
    try {
      const r = await fetch("http://127.0.0.1:" + PROXY_PORT + "/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (r.status === 200) return child;
    } catch { /* waiting for nginx */ }
    await delay(120);
  }
  child.kill("SIGTERM");
  throw new Error("nginx SSE proxy did not become healthy");
}
async function stopProxy(child) {
  if (!child) return;
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL"); resolve();
    }, 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

// The earlier Chromium Merchant sessions may keep legitimate SSE connections
// alive on the first API instance. Capacity must be measured against a fresh
// second instance: 32 is PER INSTANCE, not per test client or per store.
async function startIsolatedSseInstance(merchant, customer) {
  const root = "http://127.0.0.1:" + SECOND_API_PORT;
  const logs = [];
  const child = spawn(process.execPath, ["dist/apps/api/src/main.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(SECOND_API_PORT),
      NODE_ENV: "test",
      ENABLE_DEVELOPMENT_AUTH: "true",
      AUTH_ALLOWED_ORIGINS: merchant + "," + customer,
      GUEST_ORDER_BASE_URL: customer + "/order",
      AUTH_DATABASE_URL:
        "postgres://rcat_auth_ci:ci-auth-only@127.0.0.1:5432/rcat_ci_test",
      TENANT_DATABASE_URL:
        "postgres://rcat_app_ci:ci-tenant-only@127.0.0.1:5432/rcat_ci_test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const output of [child.stdout, child.stderr]) {
    output.on("data", (data) => {
      logs.push(String(data));
      if (logs.length > 70) logs.shift();
    });
  }
  for (let attempt = 0; attempt < 70; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error("Isolated SSE API exited: " + logs.join("").slice(-4000));
    }
    try {
      const response = await fetch(root + "/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) return { root, child };
    } catch { /* isolated API starting */ }
    await delay(250);
  }
  child.kill("SIGTERM");
  throw new Error("Second SSE API did not become healthy: " + logs.join("").slice(-4000));
}

function cookieHeader(response) {
  const raw = response.headers.getSetCookie().map((s) => s.split(";")[0]);
  const session = raw.find((s) => s.startsWith("__Host-rcat_session="));
  const csrf = raw.find((s) => s.startsWith("__Host-rcat_csrf="));
  assert.ok(session && csrf, "SSE fixture must retain secure staff session and CSRF");
  return { cookie: raw.join("; "), csrf: csrf.split("=")[1] };
}

async function login(merchant, email) {
  const result = await fetch(merchant + "/api/auth/login", {
    method: "POST",
    headers: { Origin: merchant, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "example-password-2026" }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(result.status, 200, await result.clone().text());
  return cookieHeader(result);
}

async function jsonGet(url, cookie) {
  const result = await fetch(url, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(16000),
  });
  assert.equal(result.status, 200, await result.clone().text());
  return result.json();
}

async function connect(url, cookie, origin, lastEventId) {
  const controller = new AbortController();
  const headers = { Cookie: cookie, Origin: origin };
  if (lastEventId !== undefined) headers["Last-Event-ID"] = lastEventId;
  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (res.status !== 200) {
      const status = res.status;
      const body = await res.text();
      controller.abort();
      return { status, body };
    }
    assert.match(res.headers.get("content-type") ?? "", /^text\/event-stream/);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    // nginx intentionally consumes X-Accel-Buffering. Verify actual first
    // streamed event latency in the proxy restart scenario instead.
    if (!url.includes(":" + PROXY_PORT + "/")) {
      assert.equal(res.headers.get("x-accel-buffering"), "no");
    }
    assert.ok(res.body, "Stream must provide a readable HTTP response body");
    return {
      status: 200,
      controller,
      reader: res.body.getReader(),
      decoder: new TextDecoder(),
      buffer: "",
    };
  } catch (e) {
    controller.abort();
    throw e;
  }
}

function close(conn) {
  if (conn?.controller) conn.controller.abort();
}

async function readFrame(conn, timeoutMs = SSE_DEADLINE_MS) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const split = conn.buffer.indexOf("\n\n");
    if (split >= 0) {
      const raw = conn.buffer.slice(0, split);
      conn.buffer = conn.buffer.slice(split + 2);
      const lines = raw.split("\n");
      const read = (name) =>
        lines.find((line) => line.startsWith(name + ":"))?.slice(name.length + 1).trim();
      const kind = read("event");
      if (!kind) continue; // SSE hello/retry/heartbeat frames.
      const dataText = read("data");
      const data = dataText ? JSON.parse(dataText) : {};
      return { kind, id: read("id"), data, raw };
    }
    const left = end - Date.now();
    if (left <= 0) throw new Error("Timed out reading SSE event");
    let timer;
    try {
      const chunk = await Promise.race([
        conn.reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            close(conn);
            reject(new Error("SSE frame read deadline exceeded"));
          }, left);
        }),
      ]);
      if (chunk.done) throw new Error("SSE stream ended unexpectedly");
      conn.buffer += conn.decoder.decode(chunk.value, { stream: true });
      assert.ok(conn.buffer.length < 2 * 1024 * 1024, "Unbounded SSE test buffer");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

async function untilEvent(conn, predicate, timeoutMs = SSE_DEADLINE_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = await readFrame(conn, Math.max(1, deadline - Date.now()));
    if (predicate(frame)) return frame;
  }
}

async function submit(customer, token, productId, prefix) {
  const request = await fetch(customer + "/api/guest/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: customer,
      "Idempotency-Key": prefix + "-" + randomUUID(),
    },
    body: JSON.stringify({
      visitToken: token,
      items: [{ productId, quantity: 1, optionIds: [] }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  assert.equal(request.status, 201, await request.clone().text());
  return request.json();
}

module.exports = async function qualifySse({
  db, merchant, customer, orderScope, productId, currentVisitToken,
}) {
  const all = [];
  const started = performance.now();
  let instance;
  let proxy;
  try {
    instance = await startIsolatedSseInstance(merchant, customer);
    const streamUrl = instance.root + orderScope + "/notifications/stream";
    const notificationUrl = instance.root + orderScope + "/notifications";
    const owner = await login(merchant, "a@test.invalid");
    const foreign = await login(merchant, "b@test.invalid");
    const invalid = await fetch(streamUrl, { signal: AbortSignal.timeout(12000) });
    assert.equal(invalid.status, 401, "Anonymous user could open an SSE stream");
    const denied = await fetch(streamUrl, {
      headers: { Cookie: foreign.cookie, Origin: merchant },
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(denied.status, 404, "Foreign tenant received merchant stream");

    // Original browser / HTTP flow has already emitted 27+ Order events.
    // Add 35 concurrent independent Orders to force at least two SQL outbox
    // pages (50/page), then verify no gap across the SSE page boundary.
    const seeded = await Promise.all(
      Array.from({ length: EXTRA_ORDERS }, () =>
        submit(customer, currentVisitToken, productId, "sse-backlog")),
    );
    assert.equal(new Set(seeded.map((x) => x.orderId)).size, EXTRA_ORDERS);
    // The preceding real Merchant browser flow may have already
    // acknowledged earlier Order events. SSE must start from that persisted
    // staff cursor, NOT replay events that were explicitly acknowledged.
    const first = await jsonGet(notificationUrl + "?limit=50", owner.cookie);
    assert.equal(first.events.length, 50, "Unacknowledged SSE backlog must exceed 50 events");
    assert.equal(first.hasMore, true, "Outbox pagination unexpectedly truncated");
    const second = await jsonGet(
      notificationUrl + "?after=" + first.nextCursor + "&limit=50",
      owner.cookie,
    );
    assert.ok(second.events.length >= 5, "Need at least five unacknowledged events past page 50");
    const first55 = [...first.events, ...second.events.slice(0, 5)];

    // Real nginx reverse proxy must deliver the initial event without
    // response buffering. Killing/restarting the proxy must not lose
    // unacknowledged Orders: the PostgreSQL cursor is authoritative.
    const proxyUrl = "http://127.0.0.1:" + PROXY_PORT + orderScope + "/notifications/stream";
    proxy = await startProxy();
    const proxied = await connect(proxyUrl, owner.cookie, merchant);
    all.push(proxied);
    assert.equal(proxied.status, 200);
    const firstProxyEvent = await untilEvent(
      proxied, (frame) => frame.kind === "order-event", 5000);
    assert.equal(firstProxyEvent.id, first.events[0].eventId);
    close(proxied);
    await stopProxy(proxy);
    proxy = undefined;
    proxy = await startProxy();
    const afterRestart = await connect(proxyUrl, owner.cookie, merchant);
    all.push(afterRestart);
    assert.equal(afterRestart.status, 200);
    const recovered = await untilEvent(
      afterRestart, (frame) => frame.kind === "order-event", 5000);
    assert.equal(recovered.id, firstProxyEvent.id,
      "Proxy restart lost unacknowledged Outbox replay");
    close(afterRestart);
    await stopProxy(proxy);
    proxy = undefined;

    const backlog = await connect(streamUrl, owner.cookie, merchant);
    all.push(backlog);
    assert.equal(backlog.status, 200);
    let previous = 0n;
    for (const expected of first55) {
      const observed = await untilEvent(backlog, (f) => f.kind === "order-event");
      assert.equal(observed.id, expected.eventId, "SSE replay skipped or reordered an event");
      assert.equal(observed.data.orderId, expected.orderId);
      assert.equal(observed.data.eventId, expected.eventId);
      assert.ok(BigInt(observed.id) > previous, "SSE event cursor did not advance");
      assert.equal(observed.raw.includes("trackingToken"), false);
      assert.equal(observed.raw.includes("payment"), false);
      previous = BigInt(observed.id);
    }
    close(backlog);

    // Acknowledgement persists across browser instances. The untrusted
    // Last-Event-ID header, even one far ahead, must not skip the DB-backed
    // unacknowledged tail of the feed.
    const ackId = first.nextCursor;
    const acknowledged = await fetch(notificationUrl + "/ack", {
      method: "POST",
      headers: {
        Origin: merchant,
        Cookie: owner.cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": owner.csrf,
      },
      body: JSON.stringify({ eventId: ackId }),
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(acknowledged.status, 201, await acknowledged.clone().text());
    assert.equal((await acknowledged.json()).acknowledgedCursor, ackId);
    const expectedHead = second.events[0].eventId;

    // Bound one server instance to 32 long-lived sockets. The 33rd must
    // be rejected without corrupting previously accepted SSE cursors.
    await delay(150); // allow earlier aborted socket to release its slot
    const opens = await Promise.all(
      Array.from({ length: MAX_SSE }, () =>
        connect(streamUrl, owner.cookie, merchant, "9223372036854775807")),
    );
    all.push(...opens);
    assert.equal(opens.filter((conn) => conn.status === 200).length, MAX_SSE,
      "A healthy server failed to open the documented 32-stream local cap");
    const probe = opens[0];
    const probeFirst = await untilEvent(probe, (f) => f.kind === "order-event");
    assert.equal(probeFirst.id, expectedHead,
      "Untrusted Last-Event-ID skipped persisted, unacknowledged Order events");

    const overflow = await connect(streamUrl, owner.cookie, merchant);
    assert.equal(overflow.status, 503,
      "A 33rd live connection exceeded the documented per-instance SSE capacity");
    assert.match(overflow.body, /Too many notification streams/);

    close(opens[MAX_SSE - 1]);
    let replacement;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await delay(200);
      replacement = await connect(streamUrl, owner.cookie, merchant);
      if (replacement.status === 200) break;
      assert.equal(replacement.status, 503, "Unexpected SSE retry failure");
    }
    assert.equal(replacement.status, 200,
      "Closed SSE client never freed a local connection slot");
    all.push(replacement);
    close(replacement);
    // Preserve one stream for live event and revocation detection; close
    // remaining capacity probes to avoid unnecessary CI database polling.
    for (let i = 1; i < MAX_SSE; i += 1) close(opens[i]);

    // An Order committed while the SSE was open must arrive on its 3s
    // polling cycle, even if the browser was previously behind on events.
    const fresh = await submit(customer, currentVisitToken, productId, "sse-live");
    const record = await db.query(
      "SELECT id::text AS id FROM rcat.order_outbox_events WHERE order_id=$1 AND event_type='order.submitted'",
      [fresh.orderId],
    );
    assert.equal(record.rows.length, 1);
    const live = await untilEvent(
      probe,
      (f) => f.kind === "order-event" && f.data.orderId === fresh.orderId,
      15000,
    );
    assert.equal(live.id, record.rows[0].id,
      "SSE did not deliver the committed Order's durable event");

    // Revoke current session from the server while stream is connected.
    // The next DB poll must send access-revoked and terminate the feed.
    const logout = await fetch(merchant + "/api/auth/logout", {
      method: "POST",
      headers: {
        Origin: merchant,
        Cookie: owner.cookie,
        "X-CSRF-Token": owner.csrf,
      },
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(logout.status, 204);
    const revoked = await untilEvent(
      probe,
      (f) => f.kind === "access-revoked",
      15000,
    );
    assert.equal(revoked.data.reason, "access_unavailable");
    const rejected = await fetch(streamUrl, {
      headers: { Cookie: owner.cookie, Origin: merchant },
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(rejected.status, 401,
      "Revoked staff token silently reopened an authenticated stream");

    console.log(JSON.stringify({
      scenario: "G4 SSE live capacity/replay/revoke",
      result: "PASS",
      streamsAccepted: MAX_SSE,
      overflowStatus: 503,
      backlogVerified: first55.length,
      replantedAfterDisconnect: true,
      forgedLastEventIdSkipped: false,
      committedOrderDelivered: fresh.orderId === live.data.orderId,
      revokedStreamTerminated: true,
      nginxProxyRestartReplayed: true,
      elapsedMs: Math.round(performance.now() - started),
      note: "isolated second CI NestJS instance sharing DB; not sustained multi-node throughput",
    }));
  } finally {
    for (const conn of all) close(conn);
    await stopProxy(proxy);
    instance?.child.kill("SIGTERM");
  }
};
