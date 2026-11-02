import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.CI !== "true" || process.env.PGDATABASE !== "rcat_ci_test") {
  throw new Error(
    "AUTH HTTP integration tests may run on ephemeral CI DB only",
  );
}
const port = 31917;
const origin = `http://127.0.0.1:${port}`;
let output = "";
const server = spawn(process.execPath, ["dist/apps/api/src/main.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    ENABLE_DEVELOPMENT_AUTH: "true",
    AUTH_ALLOWED_ORIGINS: origin,
    AUTH_DATABASE_URL:
      "postgres://rcat_auth_ci:ci-auth-only@127.0.0.1:5432/rcat_ci_test",
    TENANT_DATABASE_URL:
      "postgres://rcat_app_ci:ci-tenant-only@127.0.0.1:5432/rcat_ci_test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (data) => {
  output += String(data);
});
server.stderr.on("data", (data) => {
  output += String(data);
});

async function api(path, init = {}) {
  return fetch(origin + path, init);
}
const json = { "Content-Type": "application/json", Origin: origin };
try {
  let alive = false;
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode !== null) throw new Error("Server crashed: " + output);
    try {
      const r = await api("/api/health");
      if (r.status === 200) {
        alive = true;
        break;
      }
    } catch {
      /* starting */
    }
    await sleep(250);
  }
  assert.ok(alive, "API did not start: " + output);
  assert.equal((await api("/api/ready")).status, 503);

  const missingOrigin = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "a@test.invalid",
      password: "example-password-2026",
    }),
  });
  assert.equal(missingOrigin.status, 403);

  const invalid = await api("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: "a@test.invalid", password: "wrong" }),
  });
  assert.equal(invalid.status, 401);

  assert.equal((await api("/api/auth/me")).status, 401);
  const login = await api("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      email: "a@test.invalid",
      password: "example-password-2026",
    }),
  });
  assert.equal(
    login.status,
    200,
    await login.text().catch(() => "login failed"),
  );
  const cookies = login.headers.getSetCookie().map((s) => s.split(";")[0]);
  const session = cookies.find((s) => s.startsWith("__Host-rcat_session="));
  const csrf = cookies.find((s) => s.startsWith("__Host-rcat_csrf="));
  assert.ok(session && csrf, "Both session and CSRF cookies are required");
  const cookieHeader = [session, csrf].join("; ");
  const csrfToken = csrf.split("=")[1];

  const me = await api("/api/auth/me", { headers: { Cookie: cookieHeader } });
  assert.equal(me.status, 200);
  assert.equal(
    (await me.json()).userId,
    "10000000-0000-4000-8000-000000000001",
  );

  const tenantA = await api(
    "/api/tenants/00000000-0000-4000-8000-000000000001/stores",
    {
      headers: { Cookie: cookieHeader },
    },
  );
  assert.equal(tenantA.status, 200);
  const tenantResult = await tenantA.json();
  assert.equal(tenantResult.role, "owner");
  assert.deepEqual(
    tenantResult.stores.map((s) => s.slug),
    ["store-a"],
  );

  const tenantB = await api(
    "/api/tenants/00000000-0000-4000-8000-000000000002/stores",
    {
      headers: { Cookie: cookieHeader },
    },
  );
  assert.equal(
    tenantB.status,
    404,
    "User from tenant A must not read tenant B",
  );

  assert.equal(
    (
      await api("/api/auth/logout", {
        method: "POST",
        headers: { Cookie: cookieHeader, Origin: origin },
      })
    ).status,
    403,
    "Missing CSRF must reject mutation",
  );

  const logout = await api("/api/auth/logout", {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      Origin: origin,
      "X-CSRF-Token": csrfToken,
    },
  });
  assert.equal(logout.status, 204);
  assert.equal(
    (await api("/api/auth/me", { headers: { Cookie: cookieHeader } })).status,
    401,
  );

  console.log(
    "PASS: real HTTP login/session/CSRF/logout and tenant A/B restrictions",
  );
} finally {
  server.kill("SIGTERM");
}
