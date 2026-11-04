import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync("apps/merchant/public/sw.js", "utf8");
const manifest = JSON.parse(readFileSync(
  "apps/merchant/public/manifest.webmanifest", "utf8",
));
const offline = readFileSync("apps/merchant/public/offline.html", "utf8");
const handlers = new Map();
const cached = [];
const mockCache = {
  addAll: async (paths) => { cached.push(...paths); },
  put: async (request) => { cached.push(request.url); },
  match: async () => undefined,
};
const ctx = {
  self: {
    location: { origin: "https://merchant.example" },
    addEventListener(name, handler) { handlers.set(name, handler); },
    clients: { claim: async () => undefined },
  },
  caches: {
    open: async () => mockCache,
    keys: async () => [],
    delete: async () => true,
    match: async (path) => path === "/offline.html"
      ? new Response(offline, { headers: { "Content-Type": "text/html" } })
      : undefined,
  },
  URL,
  Response,
  Promise,
  fetch: async () => { throw new Error("OFFLINE"); },
};
runInNewContext(source, ctx, { filename: "sw.js" });
assert.equal(typeof ctx.isPublicStaticAsset, "function");
assert.equal(typeof handlers.get("fetch"), "function");

const request = (path, extras = {}) => ({
  url: "https://merchant.example" + path,
  method: "GET",
  destination: "document",
  mode: "navigate",
  headers: { get: () => null },
  ...extras,
});
const runFetch = (req) => {
  let promise;
  handlers.get("fetch")({
    request: req,
    respondWith(result) { promise = result; },
  });
  return promise;
};
assert.equal(runFetch(request("/api/tenants/a/stores/b/orders")), undefined);
assert.equal(runFetch(request("/api/auth/me")), undefined);
assert.equal(runFetch(request("/auth/callback")), undefined);
assert.equal(runFetch(request("/admin/tenant")), undefined);
assert.equal(runFetch(request("/orders/scope", { method: "POST" })), undefined);
assert.equal(runFetch(request("/orders/scope", {
  url: "https://another.example/orders/scope",
})), undefined);
assert.equal(runFetch(request("/api/tenants/a/notifications/stream", {
  headers: { get: () => "text/event-stream" },
})), undefined);

assert.equal(ctx.isPublicStaticAsset(
  request("/main-ABCDEFGH.js", { destination: "script", mode: "no-cors" }),
  new URL("https://merchant.example/main-ABCDEFGH.js"),
), true);
assert.equal(ctx.isPublicStaticAsset(
  request("/chunk-ABCDEFGH.js", { destination: "script", mode: "no-cors" }),
  new URL("https://merchant.example/chunk-ABCDEFGH.js"),
), true);
for (const path of [
  "/api/tenants/a/stores/b/orders",
  "/avatar-private.png",
  "/media/customer-123.png",
  "/guest/tracking-data.json",
  "/main.js",
  "/orders/scope",
  "/manifest.webmanifest",
]) {
  assert.equal(ctx.isPublicStaticAsset(
    request(path, { destination: "script", mode: "no-cors" }),
    new URL("https://merchant.example" + path),
  ), false, "Private/unhashed resource may not be cached: " + path);
}

const response = await runFetch(request("/orders/tenant/store"));
assert.equal(response.status, 200);
const content = await response.text();
assert.ok(content.includes("อุปกรณ์ขาดการเชื่อมต่อ"));
assert.ok(!content.includes("orderId"));
assert.ok(content.includes("ยังไม่สามารถตรวจสอบออเดอร์ใหม่"));

let installed;
handlers.get("install")({
  waitUntil(promise) { installed = promise; },
});
await installed;
assert.deepEqual(cached, [
  "/offline.html", "/manifest.webmanifest", "/pwa-icon.svg",
]);
assert.equal(manifest.display, "standalone");
assert.equal(manifest.scope, "/");
assert.ok(manifest.icons.some((icon) => icon.src === "/pwa-icon.svg"));
assert.ok(!source.includes("indexedDB"), "Never queue offline Order writes");
assert.ok(!source.includes("localStorage"), "Do not store credentials in the SW");
console.log("PASS: PWA offline page, static-only caching, no API/SSE/order buffering");
