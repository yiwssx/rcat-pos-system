import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuration as catalogConfig, qualify as catalogQualify } from "../../scripts/load/onprem-catalog-qualification.mjs";
import { configuration as sseConfig, qualify as sseQualify } from "../../scripts/load/onprem-sse-read-soak.mjs";

const token = "z".repeat(43);
const uuid = (n) => "00000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
const streamPath = "/api/tenants/" + uuid(11) + "/stores/" + uuid(12) + "/notifications/stream";

async function serverFor(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    server, origin: "http://127.0.0.1:" + address.port,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("A4 catalogue: only bounded, paginated staging/CI reads and 500+ unique entries", async () => {
  let requests = 0;
  const sample = await serverFor((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/guest/ordering-visit/page");
    assert.equal(req.headers.origin, "http://127.0.0.1:" + sample.server.address().port);
    let incoming = "";
    req.on("data", (chunk) => (incoming += chunk));
    req.on("end", () => {
      const body = JSON.parse(incoming);
      assert.equal(body.token, token);
      assert.equal(body.limit, 24);
      const offset = body.cursor ? Number.parseInt(body.cursor.id.slice(-12), 16) : 0;
      const end = Math.min(offset + 24, 501);
      const products = Array.from({ length: end - offset },
        (_, index) => ({ id: uuid(offset + index + 1), name: "Synthetic " + index }));
      requests += 1;
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        products, hasMore: end < 501,
        nextCursor: end < 501 ? { id: uuid(end), createdAt: "2026-11-08T10:00:00.000Z" } : null,
      }));
    });
  });
  try {
    const c = catalogConfig({
      CI: "true", RCAT_STAGING_API_URL: sample.origin + "/",
      RCAT_STAGING_CUSTOMER_ORIGIN: sample.origin,
      RCAT_STAGING_VISIT_TOKEN: token,
    });
    const result = await catalogQualify(c);
    assert.equal(result.products, 501);
    assert.equal(result.pages, 21);
    assert.equal(result.writes, 0);
    assert.equal(requests, 21);
    assert.equal(result.status, "pass");
  } finally { await sample.close(); }
});

test("A4 catalogue refuses Production, external HTTP, invalid tokens and limits", () => {
  const safe = {
    RCAT_STAGING_API_URL: "https://customer-staging.rcat.ac.th/",
    RCAT_STAGING_CUSTOMER_ORIGIN: "https://customer-staging.rcat.ac.th",
    RCAT_STAGING_VISIT_TOKEN: token,
  };
  assert.ok(catalogConfig(safe).endpoint.endsWith("/api/guest/ordering-visit/page"));
  for (const unsafe of [
    { RCAT_STAGING_API_URL: "https://customer.rcat.ac.th/" },
    { RCAT_STAGING_API_URL: "http://customer-staging.rcat.ac.th/" },
    { RCAT_STAGING_API_URL: "https://customer-staging.rcat.ac.th/?token=secret" },
    { RCAT_CATALOG_MAX_PAGES: "10000" },
    { RCAT_CATALOG_MIN_PRODUCTS: "10" },
    { RCAT_STAGING_VISIT_TOKEN: "wrong" },
  ]) {
    assert.throws(() => catalogConfig({ ...safe, ...unsafe }));
  }
});

test("A4 catalogue refuses malformed or repeated next cursor", async () => {
  let requests = 0;
  const x = await serverFor((req, res) => {
    requests += 1;
    req.resume();
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      products: [{ id: uuid(1) }],
      hasMore: true,
      nextCursor: { id: uuid(1), createdAt: "2026-11-08T10:00:00Z" },
    }));
  });
  try {
    const c = catalogConfig({
      CI: "true", RCAT_STAGING_API_URL: x.origin + "/",
      RCAT_STAGING_VISIT_TOKEN: token,
    });
    await assert.rejects(catalogQualify(c), /Repeated pagination cursor|duplicated product ID/);
    assert.equal(requests, 2);
  } finally { await x.close(); }
});

test("A4 SSE: protected staging staff cookie, bounded simultaneous read streams", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rcat-sse-"));
  const cookie = join(dir, "staff-cookie");
  const secret = "z".repeat(43);
  writeFileSync(cookie, "__Host-rcat_session=" + secret + "\n", { mode: 0o600 });
  const x = await serverFor((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, streamPath);
    assert.equal(req.headers.cookie, "__Host-rcat_session=" + secret);
    assert.equal(req.headers.accept, "text/event-stream");
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" });
    res.write(": heartbeat\n\n");
    const ticker = setInterval(() => res.write(": heartbeat\n\n"), 150);
    req.on("close", () => clearInterval(ticker));
  });
  try {
    const c = sseConfig({
      CI: "true", RCAT_STAGING_SSE_URL: x.origin + streamPath,
      RCAT_SSE_COOKIE_FILE: cookie, RCAT_SSE_STREAMS: "2", RCAT_SSE_SECONDS: "1",
    });
    const result = await sseQualify(c);
    assert.equal(result.streams, 2);
    assert.equal(result.status, "pass");
    assert.equal(result.writes, 0);
    assert.ok(result.totalFrames >= 2);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  } finally { await x.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("A4 SSE refuses paid/public target, missing or world-readable cookie and excess load", () => {
  const dir = mkdtempSync(join(tmpdir(), "rcat-sse-reject-"));
  const file = join(dir, "staff-cookie");
  writeFileSync(file, "__Host-rcat_session=" + "x".repeat(43) + "\n", { mode: 0o600 });
  const safe = {
    RCAT_STAGING_SSE_URL: "https://merchant-staging.rcat.ac.th" + streamPath,
    RCAT_SSE_COOKIE_FILE: file,
  };
  try {
    assert.equal(sseConfig(safe).count, 2);
    for (const change of [
      { RCAT_STAGING_SSE_URL: "https://merchant.rcat.ac.th" + streamPath },
      { RCAT_STAGING_SSE_URL: "https://merchant-staging.rcat.ac.th" + streamPath + "?x=1" },
      { RCAT_STAGING_SSE_URL: "https://merchant-staging.rcat.ac.th/api/guest/orders" },
      { RCAT_STAGING_SSE_URL: "http://merchant-staging.rcat.ac.th" + streamPath },
      { RCAT_SSE_STREAMS: "33" },
      { RCAT_SSE_SECONDS: "3600" },
    ]) {
      assert.throws(() => sseConfig({ ...safe, ...change }));
    }
    chmodSync(file, 0o644);
    assert.throws(() => sseConfig(safe), /mode 600/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
