/* RCAT POS Merchant PWA: STATIC-ASSETS-ONLY offline boundary.
 * Never cache API, authenticated HTML, Orders, payments, SSE, or mutations.
 * Offline screen is informational; no queued writes or fake acknowledgements.
 */
const STATIC_CACHE = "rcat-pos-merchant-static-v1";
const OFFLINE_PAGE = "/offline.html";
const SHELL_ASSETS = [OFFLINE_PAGE, "/manifest.webmanifest", "/pwa-icon.svg"];
const HASHED_SCRIPT = /^\/(?:main|polyfills|chunk)-[A-Za-z0-9_-]{8,}\.js$/;
const HASHED_STYLE = /^\/styles-[A-Za-z0-9_-]{8,}\.css$/;

function isPublicStaticAsset(request, url) {
  // Cache only build-hashed, origin-local JS/CSS with matching destination.
  // Do not cache dynamic query variants, or files disguised as scripts.
  return request.method === "GET" &&
    url.origin === self.location.origin && !url.search && !url.hash &&
    ((request.destination === "script" && HASHED_SCRIPT.test(url.pathname)) ||
     (request.destination === "style" && HASHED_STYLE.test(url.pathname)));
}
function isPrivateOrDynamicPath(pathname) {
  return pathname.startsWith("/api") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/orders/") ||
    pathname.startsWith("/reports/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/guest/") ||
    pathname.startsWith("/checkout");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("rcat-pos-merchant-static-") &&
          key !== STATIC_CACHE).map((key) => caches.delete(key)),
      )),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;
  if (request.headers?.get("accept")?.includes("text/event-stream")) return;
  if (url.pathname.startsWith("/auth") || url.pathname.startsWith("/admin")) return;

  if (request.mode === "navigate") {
    // Never cache the authenticated merchant HTML/page. When unreachable,
    // show an explicit offline screen rather than stale Order cards.
    event.respondWith(
      fetch(request).catch(async () =>
        (await caches.match(OFFLINE_PAGE)) ||
        new Response("RCAT POS offline", {
          status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      ),
    );
    return;
  }

  if (isPrivateOrDynamicPath(url.pathname)) return;

  if (isPublicStaticAsset(request, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      try {
        const response = await fetch(request);
        const cacheControl = response.headers.get("Cache-Control") || "";
        const contentType = response.headers.get("Content-Type") || "";
        const expectedContentType = request.destination === "script"
          ? /^(?:text|application)\/javascript\b/i
          : /^text\/css\b/i;
        if (response.ok && response.type === "basic" && !response.redirected &&
            expectedContentType.test(contentType) &&
            !/\b(private|no-store)\b/i.test(cacheControl)) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    })());
  }
});
