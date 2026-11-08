#!/usr/bin/env node
// G4 ON-PREM STAGING ONLY: read-only bounded proof that a seeded 500+ item
// Guest catalogue is fully pageable. No Order, stock or Payment mutations.
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function configuration(env) {
  const target = new URL(env.RCAT_STAGING_API_URL ?? "");
  const ciLocal = env.CI === "true" && target.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(target.hostname);
  const staging = target.protocol === "https:" &&
    /(?:^|[.-])(?:staging|uat)(?:[.-]|$)/i.test(target.hostname);
  if ((!ciLocal && !staging) || target.pathname !== "/" || target.search ||
      target.hash || target.username || target.password) {
    throw new Error("Staging/uat HTTPS origin required; never target Production");
  }
  const origin = env.RCAT_STAGING_CUSTOMER_ORIGIN || target.origin;
  const customer = new URL(origin);
  if (customer.origin !== origin || customer.username || customer.password ||
      customer.search || customer.hash || customer.pathname !== "/" ||
      (customer.protocol !== "https:" && !ciLocal)) {
    throw new Error("Exact staging Customer Origin required");
  }
  const token = env.RCAT_STAGING_VISIT_TOKEN;
  if (!TOKEN.test(token ?? "")) throw new Error("Staging-only visit token required");
  const minimum = Number(env.RCAT_CATALOG_MIN_PRODUCTS ?? "500");
  const maximumPages = Number(env.RCAT_CATALOG_MAX_PAGES ?? "50");
  if (!Number.isInteger(minimum) || minimum < 500 || minimum > 1200 ||
      !Number.isInteger(maximumPages) || maximumPages < 21 || maximumPages > 50) {
    throw new Error("Catalogue qualification is capped at 500..1200 items and 21..50 pages");
  }
  return { endpoint: new URL("/api/guest/ordering-visit/page", target).href,
    token, origin, minimum, maximumPages };
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a,b) => a-b);
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length*fraction)-1)] || 0);
};

export async function qualify(config, request = fetch) {
  const seen = new Set();
  const cursors = new Set();
  const durations = [];
  let cursor = null;
  let pages = 0;
  let hasMore = true;
  while (hasMore && pages < config.maximumPages) {
    const started = performance.now();
    const response = await request(config.endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Origin: config.origin },
      body: JSON.stringify({
        token: config.token, search: "", categoryId: null, cursor, limit: 24,
      }),
      signal: AbortSignal.timeout(8000),
    });
    durations.push(performance.now() - started);
    if (response.status !== 201) throw new Error("Unexpected catalogue page status");
    const page = await response.json();
    if (!page || !Array.isArray(page.products) || page.products.length < 1 ||
        page.products.length > 24 || typeof page.hasMore !== "boolean" ||
        Object.hasOwn(page, "visitToken") || JSON.stringify(page).includes(config.token)) {
      throw new Error("Invalid paginated catalogue response");
    }
    for (const product of page.products) {
      if (!product || !UUID.test(product.id) || seen.has(product.id)) {
        throw new Error("Missing or duplicated product ID across pages");
      }
      seen.add(product.id);
    }
    hasMore = page.hasMore;
    if (hasMore) {
      const next = page.nextCursor;
      if (!next || !UUID.test(next.id) || typeof next.createdAt !== "string" ||
          !Number.isFinite(Date.parse(next.createdAt))) {
        throw new Error("Missing/invalid cursor");
      }
      const key = next.createdAt + ":" + next.id;
      if (cursors.has(key)) throw new Error("Repeated pagination cursor");
      cursors.add(key);
      cursor = next;
    } else if (page.nextCursor !== null) {
      throw new Error("Terminal page must have null nextCursor");
    }
    pages += 1;
  }
  if (hasMore) throw new Error("Catalogue exceeded bounded page limit");
  if (seen.size < config.minimum) throw new Error("Seeded catalogue is smaller than approved qualification minimum");
  return {
    mode: "onprem_staging_guest_catalog_read_only",
    status: "pass",
    products: seen.size,
    pages,
    p50ms: percentile(durations, .5),
    p95ms: percentile(durations, .95),
    maxMs: Math.round(Math.max(...durations)),
    writes: 0,
    note: "Synthetic catalogue size and pagination only; not multi-hour load or Production SLO",
  };
}

async function main() {
  try {
    const result = await qualify(configuration(process.env));
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    // Never print target URLs, tokens, response bodies or customer data.
    process.stderr.write("On-prem staging Guest catalogue qualification rejected or failed\n");
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
