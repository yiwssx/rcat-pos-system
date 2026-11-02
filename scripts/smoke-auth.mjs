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
    ENABLE_REGISTRATION_TEST_MODE: "true",
    ENABLE_RECOVERY_TEST_MODE: "true",
    MAIL_PROVIDER: "test",
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

  // Isolated CI registration: no account exists until proof of email token.
  const registerBody = {
    email: "verified-new@test.invalid",
    password: "verified-new-password-2026",
  };
  assert.equal(
    (await api("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerBody),
    })).status,
    403,
    "Missing Origin must reject registration",
  );
  const register = await api("/api/auth/register", {
    method: "POST",
    headers: json,
    body: JSON.stringify(registerBody),
  });
  assert.equal(register.status, 202);
  const pending = await register.json();
  assert.equal(pending.status, "pending_verification");
  assert.equal(pending.testVerificationToken?.length, 43);

  assert.equal(
    (await api("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify(registerBody),
    })).status,
    401,
    "Unverified email must never log in",
  );

  const repeated = await api("/api/auth/register", {
    method: "POST",
    headers: json,
    body: JSON.stringify(registerBody),
  });
  assert.equal(repeated.status, 202);
  assert.equal(
    (await repeated.json()).testVerificationToken,
    undefined,
    "Cooldown must not issue a second claim token",
  );

  assert.equal(
    (await api("/api/auth/verify-email", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token: "invalid" }),
    })).status,
    404,
  );
  const verify = await api("/api/auth/verify-email", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ token: pending.testVerificationToken }),
  });
  assert.equal(verify.status, 200);
  assert.deepEqual(await verify.json(), { verified: true });

  assert.equal(
    (await api("/api/auth/verify-email", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token: pending.testVerificationToken }),
    })).status,
    404,
    "A verification token must be single-use",
  );
  const verifiedLogin = await api("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify(registerBody),
  });
  assert.equal(verifiedLogin.status, 200, "Verified account can sign in");
  assert.equal(
    (await api("/api/auth/register", {
      method: "POST",
      headers: json,
      body: JSON.stringify(registerBody),
    })).status,
    202,
    "Existing users receive generic registration response",
  );

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

  // An operator-provisioned account can create its own new store.
  const newLogin = await api("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      email: "newmerchant@test.invalid",
      password: "example-password-2026",
    }),
  });
  assert.equal(newLogin.status, 200);
  const newCookies = newLogin.headers.getSetCookie().map((s) => s.split(";")[0]);
  const newCookieHeader = newCookies.join("; ");
  const newCsrf = newCookies
    .find((s) => s.startsWith("__Host-rcat_csrf="))
    ?.split("=")[1];
  assert.ok(newCsrf);
  assert.equal(
    (await api(`/api/tenants/${made.tenantId}/stores`, {
      headers: { Cookie: newCookieHeader },
    })).status,
    404,
    "New user is not a member of another owner's tenant",
  );
  const firstStore = await api("/api/tenants", {
    method: "POST",
    headers: {
      ...json,
      Cookie: newCookieHeader,
      "X-CSRF-Token": newCsrf,
    },
    body: JSON.stringify({
      tenantSlug: "fresh-merchant-ci",
      tenantName: "ร้านใหม่",
      storeSlug: "first-branch",
      storeName: "สาขาแรก",
    }),
  });
  assert.equal(firstStore.status, 201, await firstStore.clone().text());
  const firstMerchant = await firstStore.json();
  assert.equal(firstMerchant.role, "owner");
  assert.equal(
    (await api(`/api/tenants/${firstMerchant.tenantId}/stores`, {
      headers: { Cookie: newCookieHeader },
    })).status,
    200,
  );
  assert.equal(
    (await api(`/api/tenants/${firstMerchant.tenantId}/stores`, {
      headers: { Cookie: cookieHeader },
    })).status,
    404,
    "Original owner must not see the new merchant tenant",
  );

  // Owner-only staff management with immediate permission changes.
  const staffUrl = `/api/tenants/${made.tenantId}/staff`;
  const staffList = await api(staffUrl, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(staffList.status, 200);
  const roster = (await staffList.json()).staff;
  assert.equal(roster.length, 2);
  assert.equal(roster.find((s) => s.user_id === "10000000-0000-4000-8000-000000000001")?.role, "owner");
  assert.equal(roster.find((s) => s.user_id === "10000000-0000-4000-8000-000000000002")?.role, "cashier");
  assert.equal((await api(staffUrl, {
    headers: { Cookie: bHeader },
  })).status, 404, "Cashier cannot list a tenant's roster");
  const target = `${staffUrl}/10000000-0000-4000-8000-000000000002`;
  const ownTarget = `${staffUrl}/10000000-0000-4000-8000-000000000001`;
  const ownerHeaders = { ...json, Cookie: cookieHeader, "X-CSRF-Token": csrfToken };
  const staffHeaders = { ...json, Cookie: bHeader, "X-CSRF-Token": bCsrf };
  assert.equal((await api(target, {
    method: "PATCH", headers: staffHeaders,
    body: JSON.stringify({ role: "manager" }),
  })).status, 404, "Cashier cannot elevate role");
  assert.equal((await api(target, {
    method: "PATCH", headers: { ...json, Cookie: cookieHeader },
    body: JSON.stringify({ role: "manager" }),
  })).status, 403, "Role changes require CSRF");
  const toKitchen = await api(target, {
    method: "PATCH", headers: ownerHeaders,
    body: JSON.stringify({ role: "kitchen" }),
  });
  assert.equal(toKitchen.status, 200);
  assert.equal((await toKitchen.json()).role, "kitchen");
  assert.equal((await api(`/api/tenants/${made.tenantId}/stores`, {
    headers: { Cookie: bHeader },
  })).status, 404, "Kitchen cannot read store management API");
  const toManager = await api(target, {
    method: "PATCH", headers: ownerHeaders,
    body: JSON.stringify({ role: "manager" }),
  });
  assert.equal(toManager.status, 200);
  assert.equal((await api(`/api/tenants/${made.tenantId}/stores`, {
    headers: { Cookie: bHeader },
  })).status, 200, "Manager recovers store.read permission");
  assert.equal((await api(ownTarget, {
    method: "DELETE", headers: ownerHeaders,
  })).status, 404, "Owner cannot remove themselves");
  assert.equal((await api(ownTarget, {
    method: "DELETE", headers: staffHeaders,
  })).status, 404, "Manager cannot remove owner");
  assert.equal((await api(target, {
    method: "DELETE", headers: ownerHeaders,
  })).status, 204, "Owner can remove non-owner staff");
  assert.equal((await api(`/api/tenants/${made.tenantId}/stores`, {
    headers: { Cookie: bHeader },
  })).status, 404, "Removed staff immediately loses access");
  assert.equal((await api(staffUrl, {
    headers: { Cookie: cookieHeader },
  })).status, 200, "Owner retains staff roster access");

  // Password recovery uses generic response, 20-minute one-time token and
  // revokes all existing sessions across the account's tenant memberships.
  assert.equal((await api("/api/auth/password/forgot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "newmerchant@test.invalid" }),
  })).status, 403);
  const unknown = await api("/api/auth/password/forgot", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: "unknown-account@test.invalid" }),
  });
  assert.equal(unknown.status, 202);
  assert.deepEqual(await unknown.json(), { status: "if_account_exists" });

  const requestReset = await api("/api/auth/password/forgot", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: "newmerchant@test.invalid" }),
  });
  assert.equal(requestReset.status, 202);
  const recovery = await requestReset.json();
  assert.equal(recovery.status, "if_account_exists");
  assert.equal(recovery.testRecoveryToken?.length, 43);
  const cooldown = await api("/api/auth/password/forgot", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: "newmerchant@test.invalid" }),
  });
  assert.deepEqual(await cooldown.json(), { status: "if_account_exists" });

  assert.equal((await api("/api/auth/password/reset", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ token: "invalid", newPassword: "replaced-password-2026" }),
  })).status, 400);

  const reset = await api("/api/auth/password/reset", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      token: recovery.testRecoveryToken,
      newPassword: "replaced-password-2026",
    }),
  });
  assert.equal(reset.status, 200, await reset.clone().text());
  assert.deepEqual(await reset.json(), { reset: true });
  assert.equal((await api("/api/auth/password/reset", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      token: recovery.testRecoveryToken,
      newPassword: "replaced-password-2026",
    }),
  })).status, 404, "Reset token must be consumed once");
  assert.equal((await api("/api/auth/me", {
    headers: { Cookie: newCookieHeader },
  })).status, 401, "All old sessions must be revoked");
  assert.equal((await api("/api/auth/login", {
    method: "POST", headers: json,
    body: JSON.stringify({
      email: "newmerchant@test.invalid",
      password: "example-password-2026",
    }),
  })).status, 401, "Old password must be invalid");
  assert.equal((await api("/api/auth/login", {
    method: "POST", headers: json,
    body: JSON.stringify({
      email: "newmerchant@test.invalid",
      password: "replaced-password-2026",
    }),
  })).status, 200, "New password must work");

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
