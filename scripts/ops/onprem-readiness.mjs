#!/usr/bin/env node
// On-prem Staging-only operator monitor. Read-only HTTP and safe aggregate output.
// This does NOT assert bank/Production readiness and never sends user credentials.
const names = [
  ["customer", "RCAT_POS_CUSTOMER_PORT"],
  ["merchant", "RCAT_POS_MERCHANT_PORT"],
  ["admin", "RCAT_POS_ADMIN_PORT"],
];

function configuration(env) {
  if (env.RCAT_POS_ENVIRONMENT !== "staging" ||
    !["127.0.0.1", "10.10.1.100"].includes(env.RCAT_POS_HOST_BIND_IP)) {
    throw new Error("Only the approved RCAT IOT staging listener may be monitored");
  }
  const ports = names.map(([name, key]) => {
    const raw = env[key];
    if (!/^\d{4,5}$/.test(raw ?? "") || Number(raw) < 1024 || Number(raw) > 65535) {
      throw new Error("Invalid local staging listener for " + name);
    }
    return { name, port: Number(raw) };
  });
  if (new Set(ports.map((item) => item.port)).size !== ports.length) {
    throw new Error("Duplicate staging listener ports");
  }
  return { host: env.RCAT_POS_HOST_BIND_IP, ports };
}

async function probe(host, port, path, expected) {
  const start = performance.now();
  try {
    const response = await fetch(`http://${host}:${port}${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(4000),
      headers: { Accept: expected === "document" ? "text/html" : "application/json" },
    });
    if (response.status !== 200) throw new Error("status");
    if (expected === "document") {
      if (!response.headers.get("content-type")?.startsWith("text/html")) {
        throw new Error("content-type");
      }
      await response.body?.cancel();
    } else {
      const body = await response.json();
      if (body?.service !== "rcat-pos-api" ||
        body?.productionReady !== false || body?.paymentEnabled !== false ||
        (expected === "ready" && body?.status !== "ready") ||
        (expected === "health" && body?.healthy !== true)) {
        throw new Error("invariant");
      }
    }
    return { state: "ok", status: 200, durationMs: Math.round(performance.now() - start) };
  } catch {
    return { state: "failed", durationMs: Math.round(performance.now() - start) };
  }
}

async function main() {
  const { host, ports } = configuration(process.env);
  const checks = [];
  for (const { name, port } of ports) {
    checks.push({ name, page: await probe(host, port, "/", "document"),
      health: await probe(host, port, "/api/health", "health"),
      ready: await probe(host, port, "/api/ready", "ready") });
  }
  const failures = checks.reduce((count, x) =>
    count + ["page", "health", "ready"].filter((key) => x[key].state !== "ok").length, 0);
  process.stdout.write(JSON.stringify({
    scope: "onprem_staging_nonpayment_only",
    status: failures === 0 ? "ready" : "unavailable",
    failedChecks: failures,
    checks,
  }) + "\n");
  if (failures) process.exitCode = 1;
}

main().catch(() => {
  // Never print host configuration, exception headers or arbitrary responses.
  process.stderr.write("Staging readiness monitor configuration invalid\n");
  process.exitCode = 1;
});
