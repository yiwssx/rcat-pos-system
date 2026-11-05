// CI-only: Google-only restricted database bootstrap and truthful /api/ready.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

if (process.env.CI !== "true" || process.env.PGDATABASE !== "rcat_ci_test" ||
    !["localhost", "127.0.0.1"].includes(process.env.PGHOST)) {
  throw new Error("Google-only readiness qualification requires disposable CI DB");
}
const authUrl = "postgres://rcat_auth_ci:ci-auth-only@127.0.0.1:5432/rcat_ci_test";
const appUrl = "postgres://rcat_app_ci:ci-tenant-only@127.0.0.1:5432/rcat_ci_test";
const children = [];
async function start(port, tenantUrl = appUrl) {
  const origin = "http://127.0.0.1:" + port;
  const logs = [];
  const child = spawn(process.execPath, ["dist/apps/api/src/main.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production", // Google-only mode must work without dev auth.
      ENABLE_DEVELOPMENT_AUTH: "false",
      PORT: String(port),
      AUTH_ALLOWED_ORIGINS: "https://merchant.rcat.ac.th",
      AUTH_DATABASE_URL: authUrl,
      TENANT_DATABASE_URL: tenantUrl,
      GOOGLE_OAUTH_CLIENT_ID: "rcat-google-ci-client.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "ci-fake-provider-secret-not-real",
      GOOGLE_OAUTH_REDIRECT_URI:
        "https://merchant.rcat.ac.th/api/auth/google/callback",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  for (const output of [child.stdout, child.stderr]) {
    output.on("data", (chunk) => {
      logs.push(String(chunk));
      if (logs.length > 40) logs.shift();
    });
  }
  for (let attempt = 0; attempt < 70; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error("Google-only API exited unexpectedly: " + logs.join("").slice(-2500));
    }
    try {
      const response = await fetch(origin + "/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) return origin;
    } catch { /* booting */ }
    await delay(180);
  }
  throw new Error("Google-only API failed to boot: " + logs.join("").slice(-2500));
}
module.exports = async function qualifyGoogleOnly() {
  try {
    const origin = await start(31952);
    const ready = await fetch(origin + "/api/ready");
    assert.equal(ready.status, 200, await ready.clone().text());
    const body = await ready.json();
    assert.equal(body.status, "ready");
    assert.equal(body.paymentEnabled, false);
    assert.equal(body.productionReady, false);
    assert.match(ready.headers.get("cache-control") ?? "", /no-store/);
    const login = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://merchant.rcat.ac.th",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "a@test.invalid", password: "example-password-2026",
      }),
    });
    assert.equal(login.status, 404, "Google-only API exposed password login");
    assert.equal(login.headers.get("set-cookie"), null);
    const google = await fetch(origin + "/api/auth/google/start", {
      redirect: "manual",
    });
    assert.equal(google.status, 302, await google.clone().text());
    const redirect = new URL(google.headers.get("location"));
    assert.equal(redirect.hostname, "accounts.google.com");
    assert.equal(redirect.searchParams.get("hd"), "rcat.ac.th");
    assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
    assert.ok(google.headers.get("set-cookie")?.includes("Secure"));

    const broken = await start(31953,
      "postgres://rcat_app_ci:incorrect-fixture-only@127.0.0.1:5432/rcat_ci_test");
    const notReady = await fetch(broken + "/api/ready");
    assert.equal(notReady.status, 503,
      "Readiness must fail when tenant DB credentials cannot authenticate");
    assert.deepEqual(await notReady.json(), {
      message: { status: "not_ready" }, error: "Service Unavailable", statusCode: 503,
    });
    const live = await fetch(broken + "/api/health");
    assert.equal(live.status, 200, "DB failure should not lie about process liveness");
    console.log(JSON.stringify({
      scenario: "Google-only production-mode readiness and fail-closed auth",
      result: "PASS", databaseReady: true, passwordLoginStatus: 404,
      mockProviderRedirect: 302, brokenDatabaseStatus: 503,
      paymentEnabled: false, note: "CI fake credentials, no live Google callback",
    }));
  } finally {
    for (const child of children) child.kill("SIGTERM");
  }
};
