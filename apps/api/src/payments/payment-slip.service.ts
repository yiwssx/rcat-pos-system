import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { AuthService } from "../auth/auth.service";
import { ApiRequest, header } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";
import { GuestRequestBudgetService } from "../ordering/guest-request-budget.service";
import { validatePaymentSlipPng } from "./payment-slip-png.core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING_BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

function sqlError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000" || code === "22P02") {
    throw new NotFoundException("Payment evidence unavailable");
  }
  if (code === "P0009" || code === "23505") {
    throw new ConflictException("Payment evidence changed or was already used");
  }
  if (code === "22023" || code === "23514") {
    throw new BadRequestException("Invalid payment evidence");
  }
  throw error;
}

export interface ManualPaymentDecision {
  action: "confirm" | "reject";
  expectedRevision: number;
  bankReferenceDigest: Buffer | null;
  actualAmountSatang: number | null;
  checkedBank: boolean;
}

export function validateManualDecision(raw: unknown): ManualPaymentDecision {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("Invalid payment decision");
  }
  const data = raw as Record<string, unknown>;
  const action = data["action"];
  const revision = data["expectedRevision"];
  if (
    !Number.isSafeInteger(revision) ||
    typeof revision !== "number" ||
    revision < 1 ||
    revision > 2147483646
  ) {
    throw new BadRequestException("Expected review revision required");
  }
  if (action === "reject") {
    if (Object.keys(data).sort().join(",") !== "action,expectedRevision") {
      throw new BadRequestException("Invalid rejection decision");
    }
    return {
      action,
      expectedRevision: revision,
      bankReferenceDigest: null,
      actualAmountSatang: null,
      checkedBank: false,
    };
  }
  if (
    action !== "confirm" ||
    Object.keys(data).sort().join(",") !==
      "action,actualAmountSatang,bankChecked,bankReference,expectedRevision" ||
    data["bankChecked"] !== true ||
    typeof data["bankReference"] !== "string" ||
    !/^[A-Za-z0-9._-]{6,64}$/.test(data["bankReference"]) ||
    typeof data["actualAmountSatang"] !== "number" ||
    !Number.isSafeInteger(data["actualAmountSatang"]) ||
    data["actualAmountSatang"] < 1 ||
    data["actualAmountSatang"] > 100_000_000
  ) {
    throw new BadRequestException("Explicit bank transaction check required");
  }
  return {
    action,
    expectedRevision: revision,
    // The store/tenant are additionally scoped into this digest in the
    // service. Never persist the customer's bank reference in cleartext.
    bankReferenceDigest: Buffer.from(data["bankReference"], "ascii"),
    actualAmountSatang: data["actualAmountSatang"],
    checkedBank: true,
  };
}

@Injectable()
export class PaymentSlipService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
    private readonly budget: GuestRequestBudgetService,
  ) {}

  async submitGuest(
    req: ApiRequest,
    orderId: string,
    raw: unknown,
  ): Promise<Record<string, unknown>> {
    if (!UUID.test(orderId)) {
      throw new NotFoundException("Payment evidence unavailable");
    }
    const token = TRACKING_BEARER.exec(header(req, "authorization") ?? "")?.[1];
    if (!token) throw new NotFoundException("Payment evidence unavailable");
    await this.budget.consume(req, "tracking", token);
    if (header(req, "content-type") !== "image/png") {
      throw new BadRequestException("Payment evidence must be a PNG image");
    }
    let evidence: ReturnType<typeof validatePaymentSlipPng>;
    try {
      evidence = validatePaymentSlipPng(raw);
    } catch {
      throw new BadRequestException("Invalid or oversized payment PNG");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.guest_submit_payment_slip($1,$2,$3,$4,$5) AS data",
          [
            orderId,
            digestOpaqueSecret(token),
            evidence.png,
            evidence.sha256,
            process.env["RCAT_POS_PAYMENT_QR_RELEASE_APPROVED"] === "true" &&
              process.env["RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED"] === "true",
          ],
        ),
      );
      return result.rows[0]!.data;
    } catch (error) {
      sqlError(error);
    }
  }

  async queue(req: ApiRequest, tenant: string, store: string) {
    if (!UUID.test(tenant) || !UUID.test(store)) {
      throw new NotFoundException("Payment review unavailable");
    }
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.merchant_payment_review_queue($1,$2,$3,$4) AS data",
          [digestOpaqueSecret(session.token), tenant, store, 25],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      sqlError(error);
    }
  }

  async privatePng(
    req: ApiRequest,
    tenant: string,
    store: string,
    slipId: string,
  ): Promise<{ png: Buffer; digest_sha256: Buffer }> {
    if (![tenant, store, slipId].every((id) => UUID.test(id))) {
      throw new NotFoundException("Payment evidence unavailable");
    }
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ png: Buffer; digest_sha256: Buffer }>(
          "SELECT * FROM rcat_private.merchant_payment_slip_png($1,$2,$3,$4)",
          [digestOpaqueSecret(session.token), tenant, store, slipId],
        ),
      );
      if (!result.rows[0]) {
        throw new NotFoundException("Payment evidence unavailable");
      }
      return result.rows[0];
    } catch (error) {
      sqlError(error);
    }
  }

  async decide(
    req: ApiRequest,
    tenant: string,
    store: string,
    slipId: string,
    raw: unknown,
  ) {
    if (![tenant, store, slipId].every((id) => UUID.test(id))) {
      throw new NotFoundException("Payment review unavailable");
    }
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const decision = validateManualDecision(raw);
    const refDigest = decision.bankReferenceDigest
      ? createHash("sha256")
          .update("rcat-pos-manual-bank-v1\0")
          .update(tenant)
          .update("\0")
          .update(store)
          .update("\0")
          .update(decision.bankReferenceDigest)
          .digest()
      : null;
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.merchant_payment_slip_decision($1,$2,$3,$4,$5,$6,$7,$8,$9) AS data",
          [
            digestOpaqueSecret(session.token),
            tenant,
            store,
            slipId,
            decision.expectedRevision,
            decision.action,
            refDigest,
            decision.actualAmountSatang,
            decision.checkedBank,
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      sqlError(error);
    }
  }
}
