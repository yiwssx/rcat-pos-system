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
    GUEST_ORDER_BASE_URL: origin + "/order",
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

  // Store discovery is scoped to the actual logged-in member. Frontend
  // never trusts arbitrary IDs or assumes kitchen has store.manage.
  assert.equal((await api("/api/auth/merchant-stores")).status, 401);
  const scopeList = await api("/api/auth/merchant-stores", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(scopeList.status, 200, await scopeList.clone().text());
  assert.equal(scopeList.headers.get("cache-control"), "no-store");
  const discovered = await scopeList.json();
  assert.ok(discovered.stores.some((scope) =>
    scope.tenantId === made.tenantId &&
    scope.storeId === made.storeId &&
    scope.role === "owner" &&
    scope.storeName === "ร้านหลัก"),
    "An owner should discover their own store without manually entering IDs");
  assert.ok(discovered.stores.every((scope) =>
    scope.tenantId !== "00000000-0000-4000-8000-000000000002"),
    "Store discovery cannot list an unauthorized other tenant");

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

  // G2 catalog: authenticated tenant owner controls categories/products only
  // inside the owned store; customer/order/payment endpoints do not exist yet.
  const catalogUrl = `/api/tenants/${made.tenantId}/stores/${made.storeId}/catalog`;
  const catHeaders = { ...json, Cookie: cookieHeader, "X-CSRF-Token": csrfToken };
  assert.equal((await api(catalogUrl)).status, 401);
  assert.equal((await api(catalogUrl, { headers: { Cookie: bHeader } })).status, 404);
  assert.equal((await api(catalogUrl + "/categories", {
    method: "POST", headers: { ...json, Cookie: cookieHeader },
    body: JSON.stringify({ slug: "thai-food", name: "อาหารไทย" }),
  })).status, 403, "Catalog writes require CSRF");
  const categoryResponse = await api(catalogUrl + "/categories", {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ slug: "thai-food", name: "อาหารไทย" }),
  });
  assert.equal(categoryResponse.status, 201, await categoryResponse.clone().text());
  const categoryId = (await categoryResponse.json()).categoryId;
  assert.ok(categoryId);
  assert.equal((await api(catalogUrl + "/categories", {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ slug: "thai-food", name: "duplicate" }),
  })).status, 409);
  assert.equal((await api(catalogUrl + "/products", {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ categoryId, name: "Invalid", priceSatang: 89.5 }),
  })).status, 400, "Fractional satang must be rejected");
  assert.equal((await api(catalogUrl + "/products", {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ categoryId, name: "Invalid", priceSatang: -1 }),
  })).status, 400);
  const productResponse = await api(catalogUrl + "/products", {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ categoryId, name: "ข้าวผัด", priceSatang: 8900 }),
  });
  assert.equal(productResponse.status, 201, await productResponse.clone().text());
  const productId = (await productResponse.json()).productId;
  assert.ok(productId);
  // Modifier groups/add-ons are tenant-store-product-scoped. Pricing remains
  // authoritative server-side when Orders are implemented (#6).
  const modifiersUrl = catalogUrl + "/products/" + productId + "/modifier-groups";
  assert.equal((await api(modifiersUrl, {
    method: "POST", headers: { ...json, Cookie: cookieHeader },
    body: JSON.stringify({
      slug: "extras", name: "ตัวเลือกเพิ่มเติม", minSelect: 0, maxSelect: 2,
    }),
  })).status, 403, "Modifier mutations require CSRF");
  assert.equal((await api(modifiersUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({
      slug: "invalid", name: "Invalid", minSelect: 3, maxSelect: 2,
    }),
  })).status, 400, "Invalid selection range must be rejected");
  const groupResponse = await api(modifiersUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({
      slug: "extras", name: "ตัวเลือกเพิ่มเติม", minSelect: 0, maxSelect: 2,
    }),
  });
  assert.equal(groupResponse.status, 201, await groupResponse.clone().text());
  const groupId = (await groupResponse.json()).groupId;
  assert.ok(groupId);
  assert.equal((await api(modifiersUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({
      slug: "extras", name: "Duplicate", minSelect: 0, maxSelect: 1,
    }),
  })).status, 409, "Duplicate group slug must conflict");
  const choicesUrl = modifiersUrl + "/" + groupId + "/options";
  assert.equal((await api(choicesUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ name: "Bad fraction", priceDeltaSatang: 1.5 }),
  })).status, 400, "Modifier price must be integral satang");
  const positive = await api(choicesUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ name: "เพิ่มไข่", priceDeltaSatang: 1500 }),
  });
  assert.equal(positive.status, 201, await positive.clone().text());
  const firstOptionId = (await positive.json()).optionId;
  assert.ok(firstOptionId);
  const discount = await api(choicesUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ name: "ไม่ใส่ผัก", priceDeltaSatang: -500 }),
  });
  assert.equal(discount.status, 201, await discount.clone().text());
  const discountId = (await discount.json()).optionId;
  assert.ok(discountId);
  assert.equal((await api(choicesUrl + "/" + discountId + "/availability", {
    method: "PATCH", headers: catHeaders,
    body: JSON.stringify({ available: false }),
  })).status, 200);
  assert.equal((await api(choicesUrl, {
    method: "POST",
    headers: { ...json, Cookie: bHeader, "X-CSRF-Token": bCsrf },
    body: JSON.stringify({ name: "Forbidden", priceDeltaSatang: 100 }),
  })).status, 404, "Removed staff cannot modify add-ons");

  const snapshot = await api(catalogUrl, { headers: { Cookie: cookieHeader } });
  assert.equal(snapshot.status, 200);
  const contents = await snapshot.json();
  assert.equal(contents.categories.length, 1);
  assert.equal(contents.products.length, 1);
  assert.equal(contents.products[0].priceSatang, 8900);
  assert.equal(contents.products[0].available, true);
  assert.equal(contents.modifierGroups.length, 1);
  assert.equal(contents.modifierGroups[0].maxSelect, 2);
  assert.equal(contents.modifierOptions.length, 2);
  assert.equal(
    contents.modifierOptions.find((o) => o.id === discountId)?.available, false,
  );
  assert.equal(
    contents.modifierOptions.find((o) => o.id === discountId)?.priceDeltaSatang, -500,
  );

  assert.equal((await api(catalogUrl + "/products/" + productId + "/availability", {
    method: "PATCH", headers: catHeaders,
    body: JSON.stringify({ available: false }),
  })).status, 200);
  const soldOut = await api(catalogUrl, { headers: { Cookie: cookieHeader } });
  assert.equal((await soldOut.json()).products[0].available, false);
  assert.equal((await api(
    "/api/tenants/00000000-0000-4000-8000-000000000002/stores/20000000-0000-4000-8000-000000000002/catalog",
    { headers: { Cookie: cookieHeader } },
  )).status, 404, "Tenant A must never see Tenant B catalog");
  assert.equal((await api(catalogUrl + "/products", {
    method: "POST", headers: { ...json, Cookie: bHeader, "X-CSRF-Token": bCsrf },
    body: JSON.stringify({ categoryId, name: "Unauthorized", priceSatang: 1000 }),
  })).status, 404, "Removed staff must not modify catalog");

  // Ordering QR URLs are table VISIT links; not bank or PromptPay QR codes.
  const tableUrl = `/api/tenants/${made.tenantId}/stores/${made.storeId}/tables`;
  assert.equal((await api(tableUrl, {
    method: "POST", headers: { ...json, Cookie: cookieHeader },
    body: JSON.stringify({ label: "โต๊ะ 1" }),
  })).status, 403, "Table creation requires CSRF");
  const tableResponse = await api(tableUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ label: "โต๊ะ 1" }),
  });
  assert.equal(tableResponse.status, 201, await tableResponse.clone().text());
  const tableId = (await tableResponse.json()).tableId;
  assert.ok(tableId);
  assert.equal((await api(tableUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ label: "โต๊ะ 1" }),
  })).status, 409, "Duplicate table labels must be blocked");
  const rotateUrl = tableUrl + "/" + tableId + "/rotate";
  const firstRotate = await api(rotateUrl, {
    method: "POST", headers: catHeaders,
  });
  assert.equal(firstRotate.status, 201, await firstRotate.clone().text());
  const firstVisit = await firstRotate.json();
  assert.ok(firstVisit.visitId);
  const url = new URL(firstVisit.orderingUrl);
  assert.equal(url.pathname, "/order");
  assert.equal(url.search, "", "Ordering secret must not enter URL query");
  assert.ok(url.hash.startsWith("#token="));
  const firstToken = decodeURIComponent(url.hash.slice("#token=".length));
  assert.equal(firstToken.length, 43);
  const publicResolve = async (token) =>
    api("/api/guest/ordering-visit/resolve", {
      method: "POST", headers: json, body: JSON.stringify({ token }),
    });
  const active = await publicResolve(firstToken);
  assert.equal(active.status, 201, await active.clone().text());
  const menu = await active.json();
  assert.equal(menu.visitId, firstVisit.visitId);
  assert.equal(menu.tableLabel, "โต๊ะ 1");
  assert.equal(menu.products.length, 0, "Sold-out item must not appear on guest menu");
  assert.equal(menu.categories.length, 1);
  assert.equal((await publicResolve("forged-secret")).status, 404);
  const secondRotate = await api(rotateUrl, {
    method: "POST", headers: catHeaders,
  });
  assert.equal(secondRotate.status, 201);
  const secondVisit = await secondRotate.json();
  const secondToken = decodeURIComponent(
    new URL(secondVisit.orderingUrl).hash.slice("#token=".length),
  );
  assert.notEqual(secondVisit.visitId, firstVisit.visitId);
  assert.equal((await publicResolve(firstToken)).status, 404,
    "Rotated-out table QR may never authorize old guests");
  assert.equal((await publicResolve(secondToken)).status, 201);
  assert.equal((await api(tableUrl, {
    method: "POST",
    headers: { ...json, Cookie: bHeader, "X-CSRF-Token": bCsrf },
    body: JSON.stringify({ label: "Unauthorized" }),
  })).status, 404, "Removed staff cannot create tables");
  assert.equal((await api(
    "/api/tenants/00000000-0000-4000-8000-000000000002/stores/20000000-0000-4000-8000-000000000002/tables",
    { method: "POST", headers: catHeaders,
      body: JSON.stringify({ label: "Wrong tenant" }) },
  )).status, 404);

  // G2 Order Engine: server-side satang pricing, idempotent guest checkout.
  // Re-enable only the product (one selected add-on remains available).
  assert.equal((await api(catalogUrl + "/products/" + productId + "/availability", {
    method: "PATCH", headers: catHeaders,
    body: JSON.stringify({ available: true }),
  })).status, 200);
  const orderPath = "/api/guest/orders";
  const checkout = (key, body) => api(orderPath, {
    method: "POST",
    headers: { ...json, "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  const cart = {
    visitToken: secondToken,
    items: [{ productId, quantity: 2, optionIds: [firstOptionId] }],
  };
  assert.equal((await api(orderPath, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "origin-denied-key0001" },
    body: JSON.stringify(cart),
  })).status, 403, "Order submission requires approved Origin");
  assert.equal((await api(orderPath, {
    method: "POST", headers: json, body: JSON.stringify(cart),
  })).status, 400, "Order submission requires an idempotency key");
  assert.equal((await checkout("required-choice-test01", {
    visitToken: secondToken,
    items: [{ productId, quantity: 1, optionIds: [] }],
  })).status, 201, "Optional group may have no selected options");
  assert.equal((await checkout("unavailable-option-test01", {
    visitToken: secondToken,
    items: [{ productId, quantity: 1, optionIds: [discountId] }],
  })).status, 404, "Disabled add-on may not be purchased");
  assert.equal((await checkout("duplicated-option-test01", {
    visitToken: secondToken,
    items: [{ productId, quantity: 1, optionIds: [firstOptionId, firstOptionId] }],
  })).status, 400, "Duplicate option ids must be rejected");
  assert.equal((await checkout("bogus-product-test0001", {
    visitToken: secondToken,
    items: [{ productId: "10000000-0000-4000-8000-000000000001", quantity: 1, optionIds: [] }],
  })).status, 404, "Cannot order a product outside this store");
  // A double click/retry across multiple pooled connections must create one Order.
  const replies = await Promise.all(
    Array.from({ length: 5 }, () => checkout("guest-order-retry-0001", cart)),
  );
  assert.ok(replies.every((r) => r.status === 201),
    "All retry requests should return an existing or new order");
  const payloads = await Promise.all(replies.map((r) => r.json()));
  assert.equal(new Set(payloads.map((p) => p.orderId)).size, 1);
  assert.ok(payloads.every((p) => p.amountSatang === 20800));
  assert.ok(payloads.every((p) => p.paymentState === "not_requested"));
  assert.equal(payloads.filter((p) => p.replayed === false).length, 1,
    "Exactly one retry should insert the order");
  assert.equal((await checkout("guest-order-retry-0001", {
    ...cart,
    items: [{ productId, quantity: 3, optionIds: [firstOptionId] }],
  })).status, 409, "One idempotency key cannot authorize different carts");
  // Guest tracks ONLY their own Order with a separate checkout capability.
  assert.ok(
    payloads.every((p) =>
      typeof p.trackingToken === "string" && p.trackingToken.length === 43),
    "Each checkout response must return a 256-bit tracking capability",
  );
  assert.equal(new Set(payloads.map((p) => p.trackingToken)).size, 1,
    "All checkout retries must recover the same tracking capability");
  const trackUrl = orderPath + "/" + payloads[0].orderId + "/status";
  const track = (url, token) => api(url, {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  assert.equal((await track(trackUrl)).status, 404,
    "Order ID alone cannot authorize tracking");
  assert.equal((await track(trackUrl, "A".repeat(43))).status, 404,
    "Invalid order capability must not expose its existence");
  assert.equal((await track(
    orderPath + "/11111111-1111-4111-8111-111111111111/status",
    payloads[0].trackingToken,
  )).status, 404, "A valid capability cannot enumerate Orders");
  const otherResponse = await checkout("guest-order-different-0001", cart);
  assert.equal(otherResponse.status, 201);
  const otherOrder = await otherResponse.json();
  assert.notEqual(otherOrder.trackingToken, payloads[0].trackingToken);
  assert.equal((await track(
    orderPath + "/" + otherOrder.orderId + "/status",
    payloads[0].trackingToken,
  )).status, 404, "Table visit must not reveal another checkout");
  const initialTrack = await track(trackUrl, payloads[0].trackingToken);
  assert.equal(initialTrack.status, 200);
  const initialStatus = await initialTrack.json();
  assert.equal(initialTrack.headers.get("cache-control"), "no-store");
  assert.equal(initialStatus.status, "submitted");
  assert.equal(initialStatus.paymentState, "not_requested");
  assert.equal(initialStatus.amountSatang, 20800);
  assert.ok(!Object.hasOwn(initialStatus, "trackingToken"),
    "Read endpoint must never echo bearer secret");

  // A guest can read ONLY this Order's status events with its own bearer.
  const guestHistoryUrl = orderPath + "/" + payloads[0].orderId + "/history";
  assert.equal((await track(guestHistoryUrl)).status, 404,
    "Order UUID is not sufficient to read history");
  assert.equal((await track(guestHistoryUrl, "A".repeat(43))).status, 404,
    "Forged capability cannot read Order history");
  assert.equal((await track(
    orderPath + "/" + otherOrder.orderId + "/history",
    payloads[0].trackingToken,
  )).status, 404, "Another Order's history must be private");
  const initialHistoryResponse = await track(
    guestHistoryUrl, payloads[0].trackingToken,
  );
  assert.equal(initialHistoryResponse.status, 200);
  assert.equal(initialHistoryResponse.headers.get("cache-control"), "no-store");
  const initialHistory = await initialHistoryResponse.json();
  assert.equal(initialHistory.status, "submitted");
  assert.equal(initialHistory.paymentState, "not_requested");
  assert.deepEqual(initialHistory.events.map((event) => event.status), [
    "submitted",
  ]);
  assert.ok(!Object.hasOwn(initialHistory.events[0], "actorUserId"),
    "Guest timeline must never expose staff identities");

  // Merchant fulfilment: Order inbox requires a session, and state writes
  // require Origin + CSRF. Only the merchant can see its Order snapshots.
  const merchantOrdersUrl = `/api/tenants/${made.tenantId}/stores/${made.storeId}/orders`;
  const singleOrderUrl = merchantOrdersUrl + "/" + payloads[0].orderId + "/status";
  assert.equal((await api(merchantOrdersUrl)).status, 401,
    "Anonymous visitor cannot access merchant Orders");
  assert.equal((await api(merchantOrdersUrl + "?limit=100", {
    headers: { Cookie: cookieHeader },
  })).status, 400, "Order inbox must cap result size");
  assert.equal((await api(
    "/api/tenants/00000000-0000-4000-8000-000000000002/stores/20000000-0000-4000-8000-000000000002/orders",
    { headers: { Cookie: cookieHeader } },
  )).status, 404, "Order inbox cannot cross tenant boundary");
  const inboxResponse = await api(merchantOrdersUrl + "?status=submitted&limit=25", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(inboxResponse.status, 200);
  const inbox = await inboxResponse.json();

  // G3: validated keyset pagination must not skip, duplicate or expose an
  // unrelated Order, even with multiple creation timestamp ties.
  assert.equal((await api(merchantOrdersUrl + "?cursor=invalid", {
    headers: { Cookie: cookieHeader },
  })).status, 400, "Malformed Order Inbox cursor must be rejected");
  assert.equal((await api(merchantOrdersUrl +
    "?cursor=2026-02-30T00:00:00.123456Z_11111111-1111-4111-8111-111111111111", {
    headers: { Cookie: cookieHeader },
  })).status, 400, "Impossible cursor timestamp must be rejected");
  assert.equal(inbox.hasMore, false);
  assert.equal(inbox.nextCursor, null);
  const fullInboxResponse = await api(merchantOrdersUrl + "?limit=50", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(fullInboxResponse.status, 200);
  const fullInbox = await fullInboxResponse.json();
  const pagedIds = [];
  let inboxCursor;
  for (let i = 0; i < 10; i += 1) {
    const params = "?limit=1" + (inboxCursor ?
      "&cursor=" + encodeURIComponent(inboxCursor) : "");
    const pageResponse = await api(merchantOrdersUrl + params, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(pageResponse.status, 200, await pageResponse.clone().text());
    const page = await pageResponse.json();
    assert.equal(page.orders.length, 1);
    assert.equal(page.orders[0].paymentState, "not_requested");
    pagedIds.push(page.orders[0].orderId);
    if (!page.hasMore) {
      assert.equal(page.nextCursor, null);
      break;
    }
    assert.match(page.nextCursor,
      /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z_[0-9a-f-]{36}$/);
    inboxCursor = page.nextCursor;
  }
  assert.deepEqual(pagedIds, fullInbox.orders.map((order) => order.orderId),
    "Walking keyset pages must exactly match one full Inbox snapshot");
  assert.equal(new Set(pagedIds).size, pagedIds.length,
    "No Order ID may appear on two keyset pages");


  assert.ok(inbox.orders.some((row) =>
    row.orderId === payloads[0].orderId &&
    row.amountSatang === 20800 &&
    row.paymentState === "not_requested" &&
    row.items.length === 1),
    "Merchant inbox should show immutable product snapshots");

  const merchantHistoryUrl = merchantOrdersUrl + "/" +
    payloads[0].orderId + "/history";
  assert.equal((await api(merchantHistoryUrl)).status, 401,
    "Merchant history must require staff session");
  assert.equal((await api(
    "/api/tenants/00000000-0000-4000-8000-000000000002/stores/20000000-0000-4000-8000-000000000002/orders/" +
      payloads[0].orderId + "/history",
    { headers: { Cookie: cookieHeader } },
  )).status, 404, "Merchant history may not cross tenant boundary");
  assert.equal((await api(
    merchantOrdersUrl + "/11111111-1111-4111-8111-111111111111/history",
    { headers: { Cookie: cookieHeader } },
  )).status, 404, "Unknown merchant Order history is not exposed");

  // Durable transactional Order event outbox: pagination, explicit per-user
  // acknowledgement, replay, Origin/CSRF and strict tenant/store isolation.
  const notificationsUrl =
    `/api/tenants/${made.tenantId}/stores/${made.storeId}/notifications`;
  assert.equal((await api(notificationsUrl)).status, 401,
    "Anonymous client cannot read merchant notifications");
  assert.equal((await api(notificationsUrl + "?limit=100", {
    headers: { Cookie: cookieHeader },
  })).status, 400, "Notification limit must be bounded");
  assert.equal((await api(notificationsUrl + "?after=-1", {
    headers: { Cookie: cookieHeader },
  })).status, 400, "Negative event cursor cannot be accepted");
  assert.equal((await api(notificationsUrl + "?after=9223372036854775808", {
    headers: { Cookie: cookieHeader },
  })).status, 400, "Cursor overflow must be rejected");
  assert.equal((await api(
    "/api/tenants/00000000-0000-4000-8000-000000000002/stores/20000000-0000-4000-8000-000000000002/notifications",
    { headers: { Cookie: cookieHeader } },
  )).status, 404, "Notifications must never cross tenant boundaries");
  const notificationFeed = await api(notificationsUrl + "?after=0", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(notificationFeed.status, 200,
    await notificationFeed.clone().text());
  assert.equal(notificationFeed.headers.get("cache-control"), "no-store");
  const feed = await notificationFeed.json();
  assert.equal(feed.acknowledgedCursor, "0");
  assert.equal(feed.events.length, 3,
    "Exactly three successful new Orders must be enqueued once");
  assert.ok(feed.events.every((event) =>
    event.eventType === "order.submitted" &&
    event.status === "submitted" &&
    event.previousStatus === null &&
    typeof event.eventId === "string" &&
    !Object.hasOwn(event, "trackingToken") &&
    !Object.hasOwn(event, "amountSatang")));
  assert.ok(feed.events.some((event) => event.orderId === payloads[0].orderId));
  assert.ok(feed.events.some((event) => event.orderId === otherOrder.orderId));
  const firstFeedPage = await api(notificationsUrl + "?after=0&limit=1", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(firstFeedPage.status, 200);
  const firstNotificationPage = await firstFeedPage.json();
  assert.equal(firstNotificationPage.events.length, 1);
  assert.equal(firstNotificationPage.hasMore, true);
  const firstEventId = firstNotificationPage.events[0].eventId;
  assert.equal(firstNotificationPage.nextCursor, firstEventId);
  const resumedPage = await api(
    notificationsUrl + "?after=" + firstEventId, {
      headers: { Cookie: cookieHeader },
    },
  );
  assert.equal(resumedPage.status, 200);
  assert.equal((await resumedPage.json()).events.length, 2,
    "Cursor replay after network disconnect must not skip committed events");
  const ackNotification = (eventId, headers = catHeaders) =>
    api(notificationsUrl + "/ack", {
      method: "POST", headers,
      body: JSON.stringify({ eventId }),
    });
  assert.equal((await ackNotification(firstEventId, {
    ...json, Cookie: cookieHeader,
  })).status, 403, "Explicit acknowledgement requires CSRF");
  assert.equal((await ackNotification(firstEventId, {
    ...catHeaders, Origin: undefined,
  })).status, 403, "Explicit acknowledgement requires approved Origin");
  assert.equal((await ackNotification("9223372036854775808")).status, 400,
    "Acknowledgement cannot overflow bigint");
  assert.equal((await ackNotification("0")).status, 400,
    "Zero is not a valid event acknowledgement");
  assert.equal((await ackNotification("999999999999999999")).status, 404,
    "Cannot acknowledge nonexistent or future events");
  assert.equal((await api(
    "/api/tenants/00000000-0000-4000-8000-000000000002/stores/20000000-0000-4000-8000-000000000002/notifications/ack",
    { method: "POST", headers: catHeaders,
      body: JSON.stringify({ eventId: firstEventId }) },
  )).status, 404, "Cannot acknowledge another tenant's notifications");
  const ackResponse = await ackNotification(firstEventId);
  assert.equal(ackResponse.status, 201, await ackResponse.clone().text());
  assert.equal((await ackResponse.json()).acknowledgedCursor, firstEventId);
  const resumedAck = await api(notificationsUrl, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(resumedAck.status, 200);
  assert.equal((await resumedAck.json()).events.length, 2,
    "Saved acknowledgement must allow lossless reconnect");

  const changeOrder = (expectedStatus, nextStatus, headers = catHeaders) =>
    api(singleOrderUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expectedStatus, nextStatus }),
    });
  assert.equal((await changeOrder("submitted", "accepted", {
    ...json, Cookie: cookieHeader,
  })).status, 403, "Order status change requires CSRF");
  assert.equal((await changeOrder("submitted", "accepted", {
    ...catHeaders, Origin: undefined,
  })).status, 403, "Order status change requires approved Origin");
  assert.equal((await changeOrder("submitted", "served")).status, 404,
    "Cannot skip kitchen workflow");
  const accepted = await changeOrder("submitted", "accepted");
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.equal((await accepted.json()).paymentState, "not_requested");
  assert.equal((await changeOrder("submitted", "cancelled")).status, 409,
    "Stale expected state must fail without changing Order");
  assert.equal((await changeOrder("accepted", "preparing")).status, 200);
  assert.equal((await changeOrder("preparing", "served")).status, 200);
  assert.equal((await changeOrder("served", "cancelled")).status, 404,
    "Served Orders are terminal for this workflow");
  const fulfilled = await track(trackUrl, payloads[0].trackingToken);
  assert.equal(fulfilled.status, 200);
  assert.equal((await fulfilled.json()).status, "served",
    "Guest tracking reflects the latest merchant fulfilment state");
  const servedOnly = await api(merchantOrdersUrl + "?status=served&limit=50", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(servedOnly.status, 200);
  const servedFiltered = await servedOnly.json();
  assert.deepEqual(servedFiltered.orders.map((o) => o.orderId),
    [payloads[0].orderId], "Order Inbox status filter must preserve keyset correctness");

  const guestHistoryAfter = await track(
    guestHistoryUrl, payloads[0].trackingToken,
  );
  assert.equal(guestHistoryAfter.status, 200);
  const guestTimeline = await guestHistoryAfter.json();
  assert.equal(guestTimeline.status, "served");
  assert.equal(guestTimeline.paymentState, "not_requested");
  assert.deepEqual(guestTimeline.events.map((event) => event.status), [
    "submitted", "accepted", "preparing", "served",
  ], "Failed stale transitions must not append a history event");
  assert.ok(guestTimeline.events.every((event) =>
    !Object.hasOwn(event, "actorUserId") &&
    !Object.hasOwn(event, "metadata")),
    "No staff identifiers or audit payloads may reach the guest");

  const merchantHistoryResponse = await api(merchantHistoryUrl, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(merchantHistoryResponse.status, 200);
  assert.equal(merchantHistoryResponse.headers.get("cache-control"), "no-store");
  const merchantTimeline = await merchantHistoryResponse.json();
  assert.deepEqual(merchantTimeline.events.map((event) => event.status),
    guestTimeline.events.map((event) => event.status));
  assert.ok(merchantTimeline.events.slice(1).every(
    (event) => typeof event.actorUserId === "string"),
    "Merchant timeline must attribute every staff transition");
  assert.ok(merchantTimeline.events.slice(1).every(
    (event, index, items) =>
      index === 0 || items[index - 1].eventId < event.eventId),
    "Merchant status history needs monotonic durable event identifiers");

  const afterFulfilmentResponse = await api(notificationsUrl, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(afterFulfilmentResponse.status, 200);
  const afterFulfilment = await afterFulfilmentResponse.json();
  assert.equal(afterFulfilment.events.length, 5,
    "Unacknowledged Orders and all three accepted states survive reconnect");
  assert.deepEqual(
    afterFulfilment.events.filter((event) =>
      event.orderId === payloads[0].orderId &&
      event.eventType === "order.status.changed"
    ).map((event) => event.status),
    ["accepted", "preparing", "served"],
    "Rejected/stale status changes must not emit notifications");

  // G2 operational Bill groups Orders for ONE table visit; it never
  // combines their independent payment obligations or marks money received.
  const billUrl = `/api/tenants/${made.tenantId}/stores/${made.storeId}/bills`;
  assert.equal((await api(billUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ visitId: "11111111-1111-4111-8111-111111111111" }),
  })).status, 404, "Unrecognized table visit must not create a Bill");
  assert.equal((await api(billUrl, {
    method: "POST", headers: { ...json, Cookie: cookieHeader },
    body: JSON.stringify({ visitId: secondVisit.visitId }),
  })).status, 403, "Bill creation requires CSRF");
  assert.equal((await api(billUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ visitId: "not-a-uuid" }),
  })).status, 404, "Bill creation must reject invalid visit IDs");
  assert.equal((await api(billUrl, {
    method: "POST", headers: { ...catHeaders, Origin: undefined },
    body: JSON.stringify({ visitId: secondVisit.visitId }),
  })).status, 403, "Bill creation requires approved Origin");
  assert.equal((await api(
    `/api/tenants/00000000-0000-4000-8000-000000000002/stores/20000000-0000-4000-8000-000000000002/bills`,
    { method: "POST", headers: catHeaders,
      body: JSON.stringify({ visitId: secondVisit.visitId }) },
  )).status, 404, "Bill creation cannot cross tenant boundaries");

  const makeBill = () => api(billUrl, {
    method: "POST", headers: catHeaders,
    body: JSON.stringify({ visitId: secondVisit.visitId }),
  });
  const billReplies = await Promise.all(Array.from({ length: 5 }, makeBill));
  assert.ok(billReplies.every((r) => r.status === 201),
    "Concurrent Bill retries must be harmless");
  const billCreations = await Promise.all(billReplies.map((r) => r.json()));
  assert.equal(new Set(billCreations.map((b) => b.billId)).size, 1,
    "Five concurrent Bill requests must create one Bill ID");
  assert.equal(billCreations.filter((b) => b.created).length, 1,
    "Only the initial Bill creation may emit an audit event");
  const billId = billCreations[0].billId;
  const billDetailUrl = billUrl + "/" + billId;
  assert.equal((await api(billDetailUrl)).status, 401);
  assert.equal((await api(billDetailUrl + "?limit=51", {
    headers: { Cookie: cookieHeader },
  })).status, 400, "Bill snapshot must enforce bounded list");
  assert.equal((await api(
    `/api/tenants/00000000-0000-4000-8000-000000000002/stores/20000000-0000-4000-8000-000000000002/bills/${billId}`,
    { headers: { Cookie: cookieHeader } },
  )).status, 404, "Bill snapshot must not cross tenant boundaries");

  const billBeforeResponse = await api(billDetailUrl, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(billBeforeResponse.status, 200,
    await billBeforeResponse.clone().text());
  assert.equal(billBeforeResponse.headers.get("cache-control"), "no-store");
  const billBefore = await billBeforeResponse.json();
  const sameVisitOrders = inbox.orders.filter(
    (o) => o.visitId === secondVisit.visitId,
  );
  assert.ok(sameVisitOrders.length >= 3,
    "Merchant inbox should expose visit IDs for Bill creation");
  assert.equal(billBefore.visitId, secondVisit.visitId);
  assert.equal(billBefore.orderCount, sameVisitOrders.length);
  assert.equal(
    billBefore.operationalTotalSatang,
    sameVisitOrders.reduce((sum, o) => sum + o.amountSatang, 0),
    "Bill aggregates come from independent server-priced Orders",
  );
  assert.equal(billBefore.cancelledTotalSatang, 0);
  assert.ok(billBefore.orders.every((o) => o.paymentState === "not_requested"));
  assert.ok(!Object.hasOwn(billBefore, "paymentState") &&
    !Object.hasOwn(billBefore, "paid"),
    "Operational Bill must not claim a settled payment");
  const oneOrderResponse = await api(billDetailUrl + "?limit=1", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(oneOrderResponse.status, 200);
  const singlePage = await oneOrderResponse.json();
  assert.equal(singlePage.orders.length, 1);
  assert.equal(singlePage.hasMore, true);
  assert.equal(singlePage.operationalTotalSatang,
    billBefore.operationalTotalSatang,
    "Pagination must not undercount the complete Bill");

  const cancelledOrderResponse = await api(
    merchantOrdersUrl + "/" + otherOrder.orderId + "/status", {
      method: "PATCH", headers: catHeaders,
      body: JSON.stringify({
        expectedStatus: "submitted", nextStatus: "cancelled",
      }),
    },
  );
  assert.equal(cancelledOrderResponse.status, 200,
    await cancelledOrderResponse.clone().text());
  const cancelledGuestHistory = await track(
    orderPath + "/" + otherOrder.orderId + "/history",
    otherOrder.trackingToken,
  );
  assert.equal(cancelledGuestHistory.status, 200);
  const cancelledTimeline = await cancelledGuestHistory.json();
  assert.deepEqual(cancelledTimeline.events.map((event) => event.status), [
    "submitted", "cancelled",
  ], "Cancellation must be retained as a separate Order history event");
  assert.equal(cancelledTimeline.paymentState, "not_requested");

  const afterCancelResponse = await api(billDetailUrl, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(afterCancelResponse.status, 200);
  const billAfterCancel = await afterCancelResponse.json();
  assert.equal(billAfterCancel.orderCount, billBefore.orderCount);
  assert.equal(billAfterCancel.operationalTotalSatang,
    billBefore.operationalTotalSatang - otherOrder.amountSatang,
    "Cancellation must exclude Order from operational aggregate");
  assert.equal(billAfterCancel.cancelledTotalSatang,
    otherOrder.amountSatang, "Cancellation must remain visible separately");
  assert.equal(billAfterCancel.orders.find(
    (o) => o.orderId === otherOrder.orderId,
  )?.paymentState, "not_requested", "Cancellation is not a refund");

  const afterCancellationResponse = await api(notificationsUrl, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(afterCancellationResponse.status, 200);
  const afterCancellation = await afterCancellationResponse.json();
  assert.equal(afterCancellation.events.length, 6,
    "Cancellation must emit one additional durable outbox event");
  assert.equal(afterCancellation.events.find((event) =>
    event.orderId === otherOrder.orderId &&
    event.eventType === "order.status.changed"
  )?.status, "cancelled");
  const latestEventId = afterCancellation.nextCursor;
  assert.equal((await ackNotification(latestEventId)).status, 201);
  const staleAck = await ackNotification(firstEventId);
  assert.equal(staleAck.status, 201);
  assert.equal((await staleAck.json()).acknowledgedCursor, latestEventId,
    "Out-of-order ack may never move cursor backward");
  const currentNotifications = await api(notificationsUrl, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(currentNotifications.status, 200);
  const currentFeed = await currentNotifications.json();
  assert.equal(currentFeed.acknowledgedCursor, latestEventId);
  assert.equal(currentFeed.events.length, 0);
  const fullReplay = await api(notificationsUrl + "?after=0", {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(fullReplay.status, 200);
  assert.equal((await fullReplay.json()).events.length, 7,
    "Explicit replay must retain append-only notification history");

  const changedVisit = await api(rotateUrl, {
    method: "POST", headers: catHeaders,
  });
  assert.equal(changedVisit.status, 201);
  assert.equal((await checkout("new-order-after-visit0001", cart)).status, 404,
    "Old visit cannot submit an order after rotation");

  const afterRotation = await track(trackUrl, payloads[0].trackingToken);
  assert.equal(afterRotation.status, 200);
  assert.equal((await afterRotation.json()).status, "served",
    "Rotating the table visit must not revoke existing Order tracking");
  const oldBillAfterRotation = await api(billDetailUrl, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(oldBillAfterRotation.status, 200);
  const oldBillSnapshot = await oldBillAfterRotation.json();
  assert.equal(oldBillSnapshot.orderCount, billBefore.orderCount,
    "Rotating to a new table Visit must not merge operational Bills");
  assert.equal(oldBillSnapshot.visitId, secondVisit.visitId);
  assert.notEqual(oldBillSnapshot.visitId, (await changedVisit.json()).visitId);
  const historyAfterRotation = await track(
    guestHistoryUrl, payloads[0].trackingToken,
  );
  assert.equal(historyAfterRotation.status, 200);
  assert.deepEqual(
    (await historyAfterRotation.json()).events.map((event) => event.status),
    ["submitted", "accepted", "preparing", "served"],
    "Table QR rotation must not remove existing Order history");

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

  assert.equal((await api("/api/auth/merchant-stores", {
    headers: { Cookie: cookieHeader },
  })).status, 401, "Revoked session may not discover stores");

  console.log(
    "PASS: real HTTP login/session/CSRF/logout and tenant A/B restrictions",
  );
} finally {
  server.kill("SIGTERM");
}
