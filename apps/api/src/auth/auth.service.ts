import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { PoolClient } from "pg";
import {
  digestOpaqueSecret,
  hashPassword,
  verifyPassword,
  newOpaqueSecret,
  constantTimeDigestMatch,
} from "../../../../libs/server-auth/src";
import { DatabaseAccess } from "../database/db-access";
import {
  ApiRequest,
  cookie,
  header,
  loginThrottle,
  CSRF_COOKIE,
  SESSION_COOKIE,
} from "./request-security";

type Account = { id: string; password_hash: string; is_active: boolean };
type ActiveSession = { user_id: string; csrf_digest: Buffer };
const COOKIE_LIFETIME_SECONDS = 12 * 60 * 60;

@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly database: DatabaseAccess) {}

  private dummy(): Promise<string> {
    this.dummyHash ??= hashPassword("purpose-built-dummy-password-2026");
    return this.dummyHash;
  }

  async login(
    req: ApiRequest,
    input: unknown,
  ): Promise<{ userId: string; token: string; csrf: string }> {
    if (!input || typeof input !== "object") {
      throw new UnauthorizedException("Invalid credentials");
    }
    const body = input as Record<string, unknown>;
    const email =
      typeof body["email"] === "string"
        ? body["email"].toLowerCase().trim()
        : "";
    const password = body["password"];
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" ||
      password.length > 1024
    ) {
      throw new UnauthorizedException("Invalid credentials");
    }
    const throttle = loginThrottle(req, email);
    const account = await this.database.auth(async (client) => {
      const result = await client.query<Account>(
        "SELECT id,password_hash,is_active FROM rcat.users WHERE email=$1 LIMIT 1",
        [email],
      );
      return result.rows[0];
    });

    const expected = account?.password_hash ?? (await this.dummy());
    const matches = await verifyPassword(password, expected);
    if (!matches || !account?.is_active) {
      throttle.failed();
      throw new UnauthorizedException("Invalid credentials");
    }

    throttle.succeeded();
    const token = newOpaqueSecret();
    const csrf = newOpaqueSecret();
    const digest = digestOpaqueSecret(token);
    const csrfDigest = digestOpaqueSecret(csrf);
    const issued = await this.database.auth((client) =>
      client.query<{ issued: boolean }>(
        "SELECT rcat_private.issue_session_if_current($1,$2,$3,$4) AS issued",
        [account.id, account.password_hash, digest, csrfDigest],
      ),
    );
    if (!issued.rows[0]?.issued) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return { userId: account.id, token, csrf };
  }

  async session(req: ApiRequest): Promise<{
    userId: string;
    csrfDigest: Buffer;
    token: string;
  }> {
    const token = cookie(req, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException("Session required");
    let digest: Buffer;
    try {
      digest = digestOpaqueSecret(token);
    } catch {
      throw new UnauthorizedException("Invalid session");
    }
    const row = await this.database.auth(async (client) => {
      const result = await client.query<ActiveSession>(
        `SELECT s.user_id,s.csrf_digest FROM rcat_private.auth_sessions s
           JOIN rcat.users u ON u.id=s.user_id
          WHERE s.token_digest=$1 AND s.revoked_at IS NULL
            AND s.expires_at>now() AND u.is_active=true LIMIT 1`,
        [digest],
      );
      return result.rows[0];
    });
    if (!row) throw new UnauthorizedException("Expired or revoked session");
    return { userId: row.user_id, csrfDigest: row.csrf_digest, token };
  }

  requireCsrf(req: ApiRequest, session: { csrfDigest: Buffer }): void {
    const headerToken = header(req, "x-csrf-token");
    const cookieToken = cookie(req, CSRF_COOKIE);
    if (
      !headerToken ||
      !cookieToken ||
      !constantTimeDigestMatch(session.csrfDigest, headerToken) ||
      !constantTimeDigestMatch(session.csrfDigest, cookieToken)
    ) {
      throw new ForbiddenException("Invalid CSRF token");
    }
  }

  async logout(token: string): Promise<void> {
    await this.database.auth(async (client) => {
      await client.query(
        "UPDATE rcat_private.auth_sessions SET revoked_at=now() WHERE token_digest=$1 AND revoked_at IS NULL",
        [digestOpaqueSecret(token)],
      );
    });
  }

  async membership(
    userId: string,
    tenantId: string,
  ): Promise<"owner" | "manager" | "cashier" | "kitchen" | null> {
    const rows = await this.database.authForUser(
      userId,
      async (client: PoolClient) => {
        return client.query<{
          role: "owner" | "manager" | "cashier" | "kitchen";
        }>(
          "SELECT role FROM rcat.tenant_memberships WHERE tenant_id=$1 AND user_id=$2 LIMIT 1",
          [tenantId, userId],
        );
      },
    );
    return rows.rows[0]?.role ?? null;
  }

  csrfCookie(secret: string): string {
    digestOpaqueSecret(secret);
    return [
      `${CSRF_COOKIE}=${secret}`,
      "Secure",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${COOKIE_LIFETIME_SECONDS}`,
    ].join("; ");
  }

  clearCsrfCookie(): string {
    return [
      `${CSRF_COOKIE}=`,
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=0",
    ].join("; ");
  }
}
