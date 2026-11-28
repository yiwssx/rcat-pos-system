import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import type { AuthService } from "../auth/auth.service";
import type { ApiRequest } from "../auth/request-security";
import type { DatabaseAccess } from "../database/db-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^[A-Za-z0-9_./:#-]{8,120}$/;

function strictForm(raw: unknown, keys: string): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(",") !== keys
  ) {
    throw new BadRequestException("Invalid payment approval request");
  }
  return raw as Record<string, unknown>;
}

function isReference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE.test(value);
}

function releaseReady(): boolean {
  return (
    process.env["NODE_ENV"] === "production" &&
    process.env["ENABLE_DEVELOPMENT_AUTH"] === "false" &&
    process.env["RCAT_POS_PAYMENT_QR_RELEASE_APPROVED"] === "true" &&
    process.env["RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED"] === "true"
  );
}

function reviewError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000")
    throw new ForbiddenException("Independent payment approval required");
  if (code === "P0009")
    throw new ConflictException("Receiver changed; reload approval queue");
  if (code === "22023" || code === "22P02" || code === "23514")
    throw new BadRequestException("Invalid approval request");
  throw error;
}

export class PlatformPaymentApprovalCore {
  constructor(
    private readonly auth: AuthService,
    private readonly database: DatabaseAccess,
  ) {}

  private async actor(req: ApiRequest, write: boolean) {
    const session = await this.auth.session(req);
    if (
      session.platformRole !== "super_admin" &&
      session.platformRole !== "admin"
    )
      throw new ForbiddenException("Payment administration unavailable");
    if (write) this.auth.requireCsrf(req, session);
    return digestOpaqueSecret(session.token);
  }

  async overview(req: ApiRequest, after: unknown) {
    if (after !== undefined && (typeof after !== "string" || !UUID.test(after)))
      throw new BadRequestException("Invalid queue cursor");
    const digest = await this.actor(req, false);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.platform_payment_overview($1,$2,50) AS data",
          [digest, after ?? null],
        ),
      );
      return { ...result.rows[0]?.data, releaseReady: releaseReady() };
    } catch (error) {
      reviewError(error);
    }
  }

  async grant(req: ApiRequest, userId: string, raw: unknown) {
    const digest = await this.actor(req, true);
    const body = strictForm(raw, "allowed");
    if (!UUID.test(userId) || typeof body["allowed"] !== "boolean")
      throw new BadRequestException("Invalid approval grant");
    try {
      await this.database.auth((client) =>
        client.query(
          "SELECT rcat_private.set_platform_payment_grant($1,$2,$3)",
          [digest, userId, body["allowed"]],
        ),
      );
      return { changed: true };
    } catch (error) {
      reviewError(error);
    }
  }

  async policy(req: ApiRequest, raw: unknown) {
    const digest = await this.actor(req, true);
    const body = strictForm(raw, "approvalRef,approved");
    if (
      typeof body["approved"] !== "boolean" ||
      !isReference(body["approvalRef"])
    )
      throw new BadRequestException("Invalid payment policy");
    try {
      await this.database.auth((client) =>
        client.query(
          "SELECT rcat_private.set_platform_payment_policy($1,$2,$3,$4)",
          [digest, body["approved"], body["approvalRef"], releaseReady()],
        ),
      );
      return { changed: true };
    } catch (error) {
      reviewError(error);
    }
  }

  async review(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    const digest = await this.actor(req, true);
    const body = strictForm(
      raw,
      "action,approvalRef,expectedRevision,verifiedReceiverId",
    );
    const action = body["action"];
    const revision = body["expectedRevision"];
    const verifiedId = body["verifiedReceiverId"];
    if (
      !UUID.test(tenantId) ||
      !UUID.test(storeId) ||
      (action !== "approve" && action !== "reject" && action !== "revoke") ||
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > 2147483646 ||
      !isReference(body["approvalRef"]) ||
      (action === "approve"
        ? typeof verifiedId !== "string" ||
          !/^(?:0[689][0-9]{8}|[0-9]{13})$/.test(verifiedId)
        : verifiedId !== null)
    ) {
      throw new BadRequestException("Invalid receiver review");
    }
    try {
      await this.database.auth((client) =>
        client.query(
          "SELECT rcat_private.review_platform_payment_receiver($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            digest,
            tenantId,
            storeId,
            revision,
            action,
            verifiedId,
            body["approvalRef"],
            releaseReady(),
          ],
        ),
      );
      return { changed: true };
    } catch (error) {
      reviewError(error);
    }
  }
}
