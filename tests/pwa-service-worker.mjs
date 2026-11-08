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
const cachedResponses = new Map();
const mockCache = {
  addAll: async (paths) => { cached.push(...paths); },
  put: async (request, response) => {
    cached.push(request.url);
    cachedResponses.set(request.url, response);
  },
  match: async (request) => cachedResponses.get(request.url),
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

// G3 PWA cache lifecycle: only immutable build assets may survive offline,
// never opaque login/error responses, private pages, SSE or API results.
assert.equal(ctx.isPublicStaticAsset(
  request("/styles-ABCDEFGH.css", { destination: "style", mode: "no-cors" }),
  new URL("https://merchant.example/styles-ABCDEFGH.css"),
), true);
for (const [path, destination] of [
  ["/styles-ABCDEFGH.css", "script"],
  ["/main-ABCDEFGH.js", "style"],
  ["/main-ABCDEFGH.css", "style"],
  ["/styles-ABCDEFGH.js", "script"],
  ["/main-ABCDEFGH.js?v=1", "script"],
]) {
  assert.equal(ctx.isPublicStaticAsset(
    request(path, { destination, mode: "no-cors" }),
    new URL("https://merchant.example" + path),
  ), false, "Only build-hashed JS/CSS with matching destination is cacheable");
}
const staticRequest = request("/main-ABCDEFGH.js", {
  destination: "script", mode: "no-cors",
});
const fakeStaticResponse = (contentType, cacheControl, redirected = false) => ({
  ok: true, type: "basic", redirected,
  headers: { get: (name) =>
    name.toLowerCase() === "cache-control" ? cacheControl :
    name.toLowerCase() === "content-type" ? contentType : null },
  clone() { return this; },
});
const good = fakeStaticResponse("text/javascript; charset=utf-8", "public,max-age=31536000");
ctx.fetch = async () => good;
assert.equal(await runFetch(staticRequest), good);
assert.equal(cachedResponses.get(staticRequest.url), good);
ctx.fetch = async () => { throw new Error("offline"); };
assert.equal(await runFetch(staticRequest), good, "Offline hashed JS must replay only a previously vetted public static response");

// A previously uncached hashed asset must not make unverified data available
// when a server returns login HTML, a private response or redirect.
for (const [filename, response] of [
  ["/chunk-ABCDEFGI.js", fakeStaticResponse("text/html", "public")],
  ["/chunk-ABCDEFGJ.js", fakeStaticResponse("application/javascript", "no-store")],
  ["/chunk-ABCDEFGK.js", fakeStaticResponse("application/javascript", "private")],
  ["/chunk-ABCDEFGL.js", fakeStaticResponse("application/javascript", "public", true)],
]) {
  const req = request(filename, { destination: "script", mode: "no-cors" });
  ctx.fetch = async () => response;
  assert.equal(await runFetch(req), response);
  assert.equal(cachedResponses.has(req.url), false,
    "Untrusted server response cannot enter Merchant offline cache: " + filename);
}
ctx.fetch = async () => { throw new Error("offline"); };
const neverCached = request("/chunk-ABCDEFGK.js", {
  destination: "script", mode: "no-cors",
});
await assert.rejects(runFetch(neverCached), /offline/);
assert.equal(runFetch(request("/orders/tenant/store", { method: "POST" })), undefined);
console.log("PASS: PWA offline page, static-only caching, no API/SSE/order buffering");
