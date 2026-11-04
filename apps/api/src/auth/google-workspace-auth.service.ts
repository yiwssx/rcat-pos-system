import {
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  createSessionCookie,
  digestOpaqueSecret,
  newOpaqueSecret,
} from "../../../../libs/server-auth/src";
import { DatabaseAccess } from "../database/db-access";
import { ApiRequest, cookie } from "./request-security";
import {
  GoogleJwks,
  verifyGoogleWorkspaceIdToken,
} from "./google-oidc-verifier";
import { AuthService } from "./auth.service";
import { GOOGLE_STATE_COOKIE, GOOGLE_NONCE_COOKIE, GOOGLE_VERIFIER_COOKIE, googleOauthCookies } from "./google-oauth-cookies";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

interface OauthConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEndpoint: string;
  jwksEndpoint: string;
}
interface GoogleSession {
  userId: string;
  token: string;
  csrf: string;
}
function strictProviderUrl(input: string, expectedPath: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === "https:" && !u.username && !u.password &&
      !u.hash && !u.search && u.pathname === expectedPath;
  } catch {
    return false;
  }
}
function providerOverride(name: string, fallback: string): string {
  const override = process.env[name];
  if (!override) return fallback;
  // Test-only isolated loopback mock; never override Google endpoints in
  // production or accept an attacker-selectable endpoint from a request.
  if (process.env["CI"] !== "true" || process.env["NODE_ENV"] !== "test" ||
      process.env["ENABLE_DEVELOPMENT_AUTH"] !== "true") {
    throw new ServiceUnavailableException("Invalid Google provider configuration");
  }
  const url = new URL(override);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.username || url.password || url.hash) {
    throw new ServiceUnavailableException("Invalid Google provider test endpoint");
  }
  return url.toString();
}
function config(): OauthConfiguration {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "";
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "";
  const redirectUri = process.env["GOOGLE_OAUTH_REDIRECT_URI"] ?? "";
  let callback: URL;
  try {
    callback = new URL(redirectUri);
  } catch {
    throw new ServiceUnavailableException("Google OAuth is not configured");
  }
  const localHttp =
    process.env["CI"] === "true" &&
    process.env["NODE_ENV"] === "test" &&
    callback.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(callback.hostname);
  if (clientId.length < 12 || clientId.length > 300 ||
      clientSecret.length < 12 || clientSecret.length > 1000 ||
      (!strictProviderUrl(redirectUri, "/api/auth/google/callback") &&
       !(localHttp && callback.pathname === "/api/auth/google/callback" &&
         !callback.search && !callback.hash && !callback.username && !callback.password))) {
    throw new ServiceUnavailableException("Google OAuth is not configured");
  }
  const allowed = (process.env["AUTH_ALLOWED_ORIGINS"] ?? "")
    .split(",").map((x) => x.trim()).filter(Boolean);
  if (!allowed.includes(callback.origin)) {
    throw new ServiceUnavailableException("OAuth origin is not allowlisted");
  }
  return {
    clientId, clientSecret, redirectUri,
    tokenEndpoint: providerOverride("GOOGLE_TEST_TOKEN_ENDPOINT", GOOGLE_TOKEN_URL),
    jwksEndpoint: providerOverride("GOOGLE_TEST_JWKS_ENDPOINT", GOOGLE_JWKS_URL),
  };
}
function equalSecret(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

@Injectable()
export class GoogleWorkspaceAuthService {
  private jwks?: { value: GoogleJwks; expiresAt: number };

  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  start(): { redirect: string; cookies: string[] } {
    if (!this.database.enabled) {
      throw new ServiceUnavailableException("Google Workspace login is disabled");
    }
    const opts = config();
    const state = newOpaqueSecret();
    const nonce = newOpaqueSecret();
    const verifier = newOpaqueSecret();
    const challenge = createHash("sha256")
      .update(verifier, "ascii").digest("base64url");
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", opts.clientId);
    url.searchParams.set("redirect_uri", opts.redirectUri);
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("hd", "rcat.ac.th");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    return {
      redirect: url.toString(),
      cookies: googleOauthCookies(state, nonce, verifier),
    };
  }

  private async readJwks(opts: OauthConfiguration): Promise<GoogleJwks> {
    if (this.jwks && Date.now() < this.jwks.expiresAt) return this.jwks.value;
    const response = await fetch(opts.jwksEndpoint, {
      method: "GET",
      signal: AbortSignal.timeout(7000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Google certificates unavailable");
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== "object" ||
        !Array.isArray((raw as GoogleJwks).keys)) {
      throw new Error("Malformed Google certificates");
    }
    const value = raw as GoogleJwks;
    this.jwks = { value, expiresAt: Date.now() + 2 * 60_000 };
    return value;
  }

  async complete(
    req: ApiRequest,
    suppliedState: unknown,
    suppliedCode: unknown,
  ): Promise<GoogleSession> {
    if (!this.database.enabled) {
      throw new ServiceUnavailableException("Google Workspace login is disabled");
    }
    const opts = config();
    const state = cookie(req, GOOGLE_STATE_COOKIE);
    const nonce = cookie(req, GOOGLE_NONCE_COOKIE);
    const verifier = cookie(req, GOOGLE_VERIFIER_COOKIE);
    if (typeof suppliedState !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(suppliedState) ||
        typeof state !== "string" || !equalSecret(state, suppliedState) ||
        typeof nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
        typeof verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(verifier) ||
        typeof suppliedCode !== "string" ||
        suppliedCode.length < 5 || suppliedCode.length > 2048 ||
        !/^[A-Za-z0-9_./-]+$/.test(suppliedCode)) {
      throw new UnauthorizedException("Google login unavailable");
    }

    try {
      const body = new URLSearchParams({
        code: suppliedCode,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: opts.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      });
      const response = await fetch(opts.tokenEndpoint, {
        method: "POST",
        signal: AbortSignal.timeout(7000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Google authorization code rejected");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" ||
          typeof (result as Record<string, unknown>)["id_token"] !== "string") {
        throw new Error("Missing Google ID token");
      }
      const jwt = (result as { id_token: string }).id_token;
      let jwks = await this.readJwks(opts);
      let identity;
      try {
        identity = verifyGoogleWorkspaceIdToken(jwt, opts.clientId, nonce, jwks);
      } catch {
        // Refresh cached signing keys once after rotation; never skip
        // signature, audience, nonce, hosted domain or email checks.
        this.jwks = undefined;
        jwks = await this.readJwks(opts);
        identity = verifyGoogleWorkspaceIdToken(jwt, opts.clientId, nonce, jwks);
      }
      const token = newOpaqueSecret();
      const csrf = newOpaqueSecret();
      const issued = await this.database.auth((client) =>
        client.query<{ user_id: string }>(
          "SELECT rcat_private.issue_google_workspace_session($1,$2,$3,$4) AS user_id",
          [
            identity.email,
            identity.sub,
            digestOpaqueSecret(token),
            digestOpaqueSecret(csrf),
          ],
        ),
      );
      const userId = issued.rows[0]?.user_id;
      if (!userId) throw new Error("Workspace account unavailable");
      return { userId, token, csrf };
    } catch {
      // Errors must not echo client secret, OAuth code, nonce, ID token,
      // Google claims or knowledge of a registered RCAT staff email.
      throw new UnauthorizedException("Google login unavailable");
    }
  }

  sessionCookies(result: GoogleSession): string[] {
    return [
      createSessionCookie(result.token),
      this.auth.csrfCookie(result.csrf),
    ];
  }
}
