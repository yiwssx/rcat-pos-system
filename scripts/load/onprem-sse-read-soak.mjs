#!/usr/bin/env node
// G4 ON-PREM STAGING ONLY: bounded authenticated SSE read-only connection test.
// It never acknowledges events, sends Orders, mutates stock, or touches Payment.
import { readFileSync, lstatSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STREAM_PATH = new RegExp("^/api/tenants/" + UUID + "/stores/" + UUID +
  "/notifications/stream$", "i");

export function configuration(env) {
  const url = new URL(env.RCAT_STAGING_SSE_URL ?? "");
  const ciLocal = env.CI === "true" && url.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(url.hostname);
  const staging = url.protocol === "https:" &&
    /(?:^|[.-])(?:staging|uat)(?:[.-]|$)/i.test(url.hostname);
  if ((!ciLocal && !staging) || !STREAM_PATH.test(url.pathname) || url.search ||
      url.hash || url.username || url.password) {
    throw new Error("Exact staging/uat Merchant HTTPS SSE endpoint required");
  }
  const count = Number(env.RCAT_SSE_STREAMS ?? "2");
  const seconds = Number(env.RCAT_SSE_SECONDS ?? (ciLocal ? "2" : "30"));
  if (!Number.isInteger(count) || count < 1 || count > 4 ||
      !Number.isInteger(seconds) || seconds < (ciLocal ? 1 : 15) || seconds > 90) {
    throw new Error("SSE bounded limits: 1..4 streams and 15..90 seconds");
  }
  const cookieFile = env.RCAT_SSE_COOKIE_FILE;
  if (!cookieFile || !cookieFile.startsWith("/")) {
    throw new Error("Absolute protected staging staff cookie file required");
  }
  const stat = lstatSync(cookieFile);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("Cookie file must be regular, mode 600, not a symlink");
  }
  const cookie = readFileSync(cookieFile, "utf8").trim();
  if (cookie.length > 2048 ||
      !/^__Host-rcat_session=[A-Za-z0-9_-]{43}(?:; __Host-rcat_csrf=[A-Za-z0-9_-]{43})?$/.test(cookie)) {
    throw new Error("Protected file must hold one staging session cookie");
  }
  return { url: url.href, cookie, count, seconds };
}

async function oneStream(config, fetchImpl) {
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), config.seconds * 1000);
  let streamAccepted = false;
  let frames = 0;
  let bytes = 0;
  let completedEarly = false;
  const started = performance.now();
  try {
    const response = await fetchImpl(config.url, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "text/event-stream", Cookie: config.cookie },
      cache: "no-store",
      signal: abort.signal,
    });
    if (response.status !== 200 ||
        !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") ||
        !response.body) throw new Error("SSE status/content type not available");
    streamAccepted = true;
    const reader = response.body.getReader();
    let buffer = "";
    while (!abort.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) { completedEarly = true; break; }
      bytes += value.byteLength;
      if (bytes > 1_048_576) throw new Error("SSE budget exceeded");
      buffer += new TextDecoder().decode(value);
      if (buffer.length > 65_536) throw new Error("SSE incomplete frame exceeded limit");
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";
      frames += parts.length;
    }
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    clearTimeout(deadline);
    abort.abort();
  }
  const elapsed = performance.now() - started;
  if (!streamAccepted || completedEarly || elapsed < config.seconds * 1000 * .85) {
    throw new Error("SSE stream did not persist for its bounded duration");
  }
  return { connection: "ok", durationMs: Math.round(elapsed), frames, bytes };
}

export async function qualify(config, fetchImpl = fetch) {
  const connections = await Promise.all(
    Array.from({ length: config.count }, () => oneStream(config, fetchImpl)),
  );
  return {
    mode: "onprem_staging_sse_read_only",
    status: "pass",
    streams: connections.length,
    minDurationMs: Math.min(...connections.map((s) => s.durationMs)),
    totalFrames: connections.reduce((sum, s) => sum + s.frames, 0),
    totalBytes: connections.reduce((sum, s) => sum + s.bytes, 0),
    writes: 0,
    note: "Proxy connection persistence only; replica attribution, Order delivery and reconciliation require independent test evidence",
  };
}

async function main() {
  try {
    process.stdout.write(JSON.stringify(await qualify(configuration(process.env))) + "\n");
  } catch {
    // Never print session cookie, URL, SSE contents or raw HTTP error.
    process.stderr.write("On-prem staging SSE read-only qualification rejected or failed\n");
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
