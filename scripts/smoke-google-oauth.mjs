import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.CI !== "true" || process.env.PGDATABASE !== "rcat_ci_test") {
  throw new Error("Google OAuth HTTP integration is CI-fixture-only");
}

const apiPort = 31919;
const providerPort = 31920;
const origin = `http://127.0.0.1:${apiPort}`;
const mockOrigin = `http://127.0.0.1:${providerPort}`;
const clientId = "rcat-google-ci-client.apps.googleusercontent.com";
const clientSecret = "ci-google-secret-not-production";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
const seenCodes = new Set();
let nonce = "";
let challenge = "";
let subject = "109876543210098765432";
let email = "staff@rcat.ac.th";
let hostedDomain = "rcat.ac.th";
let verified = true;

function signedIdToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "rcat-ci-key" };
  const payload = {
    iss: "https://accounts.google.com", aud: clientId,
    nonce, sub: subject, email, hd: hostedDomain,
    email_verified: verified, iat: now - 5, exp: now + 600,
  };
  const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const data = encoded(header) + "." + encoded(payload);
  return data + "." + sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url");
}
const mockGoogle = createServer(async (req, res) => {
  try {
    if (req.url === "/jwks" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [
        { ...jwk, alg: "RS256", kid: "rcat-ci-key", use: "sig" },
      ] }));
      return;
    }
    if (req.url === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      const params = new URLSearchParams(raw);
      const code = params.get("code");
      const verifier = params.get("code_verifier") ?? "";
      const digest = createHash("sha256").update(verifier, "ascii").digest("base64url");
      if (!code || !/^ci-test-code-[0-9]+$/.test(code) ||
          seenCodes.has(code) || params.get("client_id") !== clientId ||
          params.get("client_secret") !== clientSecret ||
          params.get("redirect_uri") !== origin + "/api/auth/google/callback" ||
          params.get("grant_type") !== "authorization_code" ||
          digest !== challenge) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"invalid_grant"}');
        return;
      }
      seenCodes.add(code);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id_token: signedIdToken(), token_type: "Bearer" }));
      return;
    }
    res.writeHead(404);
    res.end();
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((resolve) => mockGoogle.listen(providerPort, "127.0.0.1", resolve));

let output = "";
const apiServer = spawn(process.execPath, ["dist/apps/api/src/main.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(apiPort),
    ENABLE_DEVELOPMENT_AUTH: "true",
    AUTH_ALLOWED_ORIGINS: origin,
    GOOGLE_OAUTH_CLIENT_ID: clientId,
    GOOGLE_OAUTH_CLIENT_SECRET: clientSecret,
    GOOGLE_OAUTH_REDIRECT_URI: origin + "/api/auth/google/callback",
    GOOGLE_TEST_TOKEN_ENDPOINT: mockOrigin + "/token",
    GOOGLE_TEST_JWKS_ENDPOINT: mockOrigin + "/jwks",
    AUTH_DATABASE_URL:
      "postgres://rcat_auth_ci:ci-auth-only@127.0.0.1:5432/rcat_ci_test",
    TENANT_DATABASE_URL:
      "postgres://rcat_app_ci:ci-tenant-only@127.0.0.1:5432/rcat_ci_test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
apiServer.stdout.on("data", (data) => { output += String(data); });
apiServer.stderr.on("data", (data) => { output += String(data); });

async function api(path, init = {}) {
  return fetch(origin + path, { redirect: "manual", ...init });
}
const cookiesOf = (response) => response.headers.getSetCookie();
const cookieHeader = (setCookies) => setCookies
  .map((entry) => entry.split(";")[0]).join("; ");

try {
  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    if (apiServer.exitCode !== null) throw new Error("API failed to boot: " + output);
    try {
      if ((await api("/api/health")).status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* not started */
    }
    await sleep(250);
  }
  assert.ok(ready, "Google OAuth integration API unavailable");

  let sequence = 0;
  const begin = async () => {
    const response = await api("/api/auth/google/start");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const target = new URL(response.headers.get("location"));
    assert.equal(target.origin, "https://accounts.google.com");
    assert.equal(target.searchParams.get("hd"), "rcat.ac.th");
    assert.equal(target.searchParams.get("scope"), "openid email");
    assert.equal(target.searchParams.get("code_challenge_method"), "S256");
    assert.equal(target.searchParams.get("client_id"), clientId);
    const cookies = cookiesOf(response);
    assert.equal(cookies.length, 3);
    assert.ok(cookies.every((x) => x.includes("HttpOnly") &&
      x.includes("Secure") && x.includes("Max-Age=300")));
    const state = target.searchParams.get("state");
    const token = target.searchParams.get("nonce");
    assert.ok(state && token);
    challenge = target.searchParams.get("code_challenge");
    nonce = token;
    sequence += 1;
    return { state, cookies: cookieHeader(cookies), code: "ci-test-code-" + sequence };
  };
  const callback = (entry, state = entry.state) =>
    api("/api/auth/google/callback?state=" + encodeURIComponent(state) +
      "&code=" + encodeURIComponent(entry.code), {
      headers: { Cookie: entry.cookies },
    });

  const attempt = await begin();
  const forgedState = await callback(attempt, "z".repeat(43));
  assert.equal(forgedState.status, 303);
  assert.equal(forgedState.headers.get("location"), "/?login=failed");
  assert.ok(!cookiesOf(forgedState).some((x) =>
    x.startsWith("__Host-rcat_session=")));

  const valid = await begin();
  const success = await callback(valid);
  assert.equal(success.status, 303);
  assert.equal(success.headers.get("location"), "/");
  const cookies = cookiesOf(success);
  assert.ok(cookies.some((x) => x.startsWith("__Host-rcat_session=") &&
    x.includes("Secure") && x.includes("HttpOnly")));
  assert.ok(cookies.some((x) => x.startsWith("__Host-rcat_csrf=")));
  assert.ok(cookies.some((x) =>
    x.startsWith("__Host-rcat_google_state=") && x.includes("Max-Age=0")));
  const sessionCookie = cookieHeader(cookies.filter((x) =>
    x.startsWith("__Host-rcat_session=") || x.startsWith("__Host-rcat_csrf=")));
  const me = await api("/api/auth/me", { headers: { Cookie: sessionCookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).userId, "10000000-0000-4000-8000-000000000045");
  const scoped = await api("/api/auth/merchant-stores", {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(scoped.status, 200);
  assert.ok((await scoped.json()).stores.some((x) =>
    x.tenantId === "00000000-0000-4000-8000-000000000001" &&
    x.role === "manager"));

  const maliciousDomain = await begin();
  hostedDomain = "gmail.com";
  assert.equal((await callback(maliciousDomain)).headers.get("location"),
    "/?login=failed", "Workspace domain hint must not replace signed hd");
  hostedDomain = "rcat.ac.th";

  const recycledAccount = await begin();
  subject = "109876543210098765433";
  assert.equal((await callback(recycledAccount)).headers.get("location"),
    "/?login=failed", "New Google sub cannot take existing RCAT account");
  subject = "109876543210098765432";

  const unapprovedAccount = await begin();
  email = "unknown@rcat.ac.th";
  assert.equal((await callback(unapprovedAccount)).headers.get("location"),
    "/?login=failed", "Unknown Workspace accounts cannot self-provision");
  email = "staff@rcat.ac.th";

  const repeat = await begin();
  assert.equal((await callback(repeat)).headers.get("location"), "/",
    "Previously bound Google sub can authenticate again");

  const replay = await callback(valid);
  assert.equal(replay.headers.get("location"), "/?login=failed",
    "Authorization code replay must be denied");
  console.log("PASS: signed Google OIDC login, session, tenant scope, forgery/hd/sub denial and code replay");
} finally {
  apiServer.kill("SIGTERM");
  mockGoogle.closeAllConnections();
  mockGoogle.close();
}
