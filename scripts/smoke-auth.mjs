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

  // Owner-only creation is atomic; no account or tenant can be impersonated.
  const noCsrfCreate = await api("/api/tenants", {
    method: "POST", headers: { ...json, Cookie: cookieHeader },
    body: JSON.stringify({
      tenantSlug: "merchant-ci", tenantName: "ร้านทดสอบ",
      storeSlug: "main-store", storeName: "ร้านหลัก",
    }),
  });
  assert.equal(noCsrfCreate.status, 403);
  const create = await api("/api/tenants", {
    method: "POST",
    headers: { ...json, Cookie: cookieHeader, "X-CSRF-Token": csrfToken },
    body: JSON.stringify({
      tenantSlug: "merchant-ci", tenantName: "ร้านทดสอบ",
      storeSlug: "main-store", storeName: "ร้านหลัก",
    }),
  });
  assert.equal(create.status, 201, await create.clone().text());
  const made = await create.json();
  assert.equal(made.role, "owner");
  assert.ok(made.tenantId && made.storeId);

  const listed = await api(`/api/tenants/${made.tenantId}/stores`, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).stores.map((s) => s.slug), ["main-store"]);

  const duplicate = await api("/api/tenants", {
    method: "POST", headers: { ...json, Cookie: cookieHeader, "X-CSRF-Token": csrfToken },
    body: JSON.stringify({
      tenantSlug: "merchant-ci", tenantName: "Duplicate",
      storeSlug: "main-store", storeName: "Duplicate",
    }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await api("/api/tenants", {
    method: "POST", headers: { ...json, Cookie: cookieHeader, "X-CSRF-Token": csrfToken },
    body: JSON.stringify({
      tenantSlug: "BAD SLUG", tenantName: "Invalid", storeSlug: "main-store", storeName: "Test",
    }),
  })).status, 400);

  const invite = await api(`/api/tenants/${made.tenantId}/invitations`, {
    method: "POST", headers: { ...json, Cookie: cookieHeader, "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ email: "b@test.invalid", role: "cashier" }),
  });
  assert.equal(invite.status, 201, await invite.clone().text());
  const invitation = await invite.json();
  assert.ok(invitation.invitationToken);
  assert.equal((await api(`/api/tenants/${made.tenantId}/invitations`, {
    method: "POST", headers: { ...json, Cookie: cookieHeader, "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ email: "b@test.invalid", role: "owner" }),
  })).status, 400);

  const wrongRecipient = await api("/api/invitations/accept", {
    method: "POST", headers: { ...json, Cookie: cookieHeader, "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ invitationToken: invitation.invitationToken }),
  });
  assert.equal(wrongRecipient.status, 404, "Owner must not redeem cashier invite");

  const bLogin = await api("/api/auth/login", {
    method: "POST", headers: json,
    body: JSON.stringify({ email: "b@test.invalid", password: "example-password-2026" }),
  });
  assert.equal(bLogin.status, 200);
  const bCookies = bLogin.headers.getSetCookie().map((s) => s.split(";")[0]);
  const bHeader = bCookies.join("; ");
  const bCsrf = bCookies.find((s) => s.startsWith("__Host-rcat_csrf="))?.split("=")[1];
  assert.ok(bCsrf);
  assert.equal((await api(`/api/tenants/${made.tenantId}/stores`, {
    headers: { Cookie: bHeader },
  })).status, 404, "No access before invitation acceptance");

  const accept = await api("/api/invitations/accept", {
    method: "POST", headers: { ...json, Cookie: bHeader, "X-CSRF-Token": bCsrf },
    body: JSON.stringify({ invitationToken: invitation.invitationToken }),
  });
  assert.equal(accept.status, 200, await accept.clone().text());
  assert.equal((await accept.json()).role, "cashier");
  const staffStores = await api(`/api/tenants/${made.tenantId}/stores`, {
    headers: { Cookie: bHeader },
  });
  assert.equal(staffStores.status, 200);
  assert.equal((await staffStores.json()).role, "cashier");
  assert.equal((await api("/api/invitations/accept", {
    method: "POST", headers: { ...json, Cookie: bHeader, "X-CSRF-Token": bCsrf },
    body: JSON.stringify({ invitationToken: invitation.invitationToken }),
  })).status, 404, "Single-use invite cannot be redeemed twice");
  assert.equal((await api(`/api/tenants/${made.tenantId}/invitations`, {
    method: "POST", headers: { ...json, Cookie: bHeader, "X-CSRF-Token": bCsrf },
    body: JSON.stringify({ email: "a@test.invalid", role: "manager" }),
  })).status, 404, "Cashier must not invite staff");
  assert.equal((await api(`/api/tenants/${made.tenantId}/invitations`, {
    method: "POST", headers: { ...json, Cookie: bHeader, "X-CSRF-Token": bCsrf },
    body: JSON.stringify({ email: "a@test.invalid", role: "owner" }),
  })).status, 400, "Owner invitations forbidden");

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
