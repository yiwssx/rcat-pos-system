#!/usr/bin/env node
// Bounded read-only G4 Guest catalog soak; NEVER submits Orders or payments.
import process from "node:process";
import { performance } from "node:perf_hooks";

function config(env) {
  const url = new URL(env.RCAT_STAGING_API_URL ?? "");
  const localCI =
    env.CI === "true" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.protocol === "http:";
  const staging =
    url.protocol === "https:" &&
    /(?:^|[.-])(?:staging|uat)(?:[.-]|$)/i.test(url.hostname);
  if ((!localCI && !staging) || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new Error("Refusing target: use an HTTPS staging/uat API origin only");
  }
  const token = env.RCAT_STAGING_VISIT_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("A valid staging-only Guest visit token is required");
  }
  const count = Number(env.RCAT_SOAK_REQUESTS ?? "60");
  const concurrency = Number(env.RCAT_SOAK_CONCURRENCY ?? "4");
  if (!Number.isInteger(count) || count < 1 || count > 60 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("Bounded safety limits: 1..60 reads and 1..8 workers");
  }
  const origin = env.RCAT_STAGING_CUSTOMER_ORIGIN || url.origin;
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== "https:" && !localCI)) {
    throw new Error("Customer Origin must be an exact staging HTTPS origin");
  }
  return {
    endpoint: new URL("/api/guest/ordering-visit/page",url).href,
    token,origin,count,concurrency,
  };
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a,b)=>a-b);
  return Math.round(sorted[Math.ceil(sorted.length*pct/100)-1]);
}

async function main() {
  const c = config(process.env);
  const latencies = [];
  const status = {};
  let started = 0;
  let badSchema = 0;
  async function worker() {
    while (started < c.count) {
      started += 1;
      const start = performance.now();
      let code;
      try {
        const r = await fetch(c.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: c.origin },
          body: JSON.stringify({
            token: c.token,search:"",categoryId:null,cursor:null,limit:24,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        code = r.status;
        if (code === 201) {
          const value = await r.json();
          if (
            !Array.isArray(value.products) ||
            value.products.length > 24 ||
            typeof value.hasMore !== "boolean" ||
            Object.hasOwn(value,"visitToken") ||
            JSON.stringify(value).includes(c.token)
          ) badSchema += 1;
        } else {
          await r.body?.cancel();
        }
      } catch {
        code = "network_failure";
      }
      latencies.push(performance.now()-start);
      status[code] = (status[code] ?? 0)+1;
    }
  }
  await Promise.all(Array.from({ length: c.concurrency }, () => worker()));
  const success = status[201] ?? 0;
  process.stdout.write(JSON.stringify({
    mode:"read_only_staging_guest_page",
    requests:c.count,concurrency:c.concurrency,status,
    p50ms:percentile(latencies,50),p95ms:percentile(latencies,95),
    maxMs:Math.round(Math.max(...latencies)),
    invalidResponseSchemas:badSchema,
    note:"No real mobile-network, merchant throughput or Payment qualification is implied",
  })+"\n");
  if (success !== c.count || badSchema) {
    throw new Error("Staging Guest read qualification failed");
  }
}

main().catch(() => {
  // Never log bearer tokens, URLs with credentials, or response payloads.
  process.stderr.write("Staging Guest read qualification rejected or failed\n");
  process.exitCode = 1;
});
