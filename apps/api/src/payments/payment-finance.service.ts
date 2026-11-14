import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { AuthService } from "../auth/auth.service";
import type { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";
import {
  parseExceptionResolution,
  parseFinanceDays,
  parsePaymentException,
  parseRefundDecision,
  parseRefundRequest,
} from "./payment-finance.core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sqlFailure(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000" || code === "22P02") {
    throw new NotFoundException("Manual finance record unavailable");
  }
  if (code === "P0009" || code === "23505") {
    throw new ConflictException("Manual finance record changed; reload");
  }
  if (code === "22023" || code === "23514") {
    throw new BadRequestException("Invalid manual finance request");
  }
  throw error;
}

function parse<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new BadRequestException("Invalid manual finance request");
  }
}
function scope(tenant: string, store: string): void {
  if (!UUID.test(tenant) || !UUID.test(store)) {
    throw new NotFoundException("Manual finance scope unavailable");
  }
}
function digestBankRefundReference(
  tenant: string,
  store: string,
  bankReference: string,
): Buffer {
  // Store-scoped, one-way duplicate fingerprint; a reference is NOT bank proof.
  return createHash("sha256")
    .update("rcat-pos-manual-bank-refund-v1\0")
    .update(tenant)
    .update("\0")
    .update(store)
    .update("\0")
    .update(bankReference)
    .digest();
}

@Injectable()
export class PaymentFinanceService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  private release(): boolean {
    return process.env["RCAT_POS_PAYMENT_FINANCE_RELEASE_APPROVED"] === "true";
  }

  async report(req: ApiRequest, tenant: string, store: string, days: unknown) {
    scope(tenant, store);
    const period = parse(() => parseFinanceDays(days));
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.merchant_manual_payment_report($1,$2,$3,$4) AS data",
          [digestOpaqueSecret(session.token), tenant, store, period],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      sqlFailure(error);
    }
  }

  async requestRefund(
    req: ApiRequest,
    tenant: string,
    store: string,
    body: unknown,
  ) {
    scope(tenant, store);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = parse(() => parseRefundRequest(body));
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.request_manual_payment_refund($1,$2,$3,$4,$5,$6,$7) AS data",
          [
            digestOpaqueSecret(session.token), tenant, store,
            data.orderId, data.amountSatang, data.reason, this.release(),
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      sqlFailure(error);
    }
  }

  async refundDecision(
    req: ApiRequest,
    tenant: string,
    store: string,
    refundId: string,
    body: unknown,
  ) {
    scope(tenant, store);
    if (!UUID.test(refundId)) throw new NotFoundException("Refund unavailable");
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = parse(() => parseRefundDecision(body));
    const digest = data.bankReference
      ? digestBankRefundReference(tenant, store, data.bankReference)
      : null;
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.decide_manual_payment_refund($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS data",
          [
            digestOpaqueSecret(session.token), tenant, store, refundId,
            data.expectedRevision, data.action, digest,
            data.actualAmountSatang, data.bankChecked, this.release(),
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      sqlFailure(error);
    }
  }

  async createException(
    req: ApiRequest,
    tenant: string,
    store: string,
    body: unknown,
  ) {
    scope(tenant, store);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = parse(() => parsePaymentException(body));
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.open_manual_payment_exception($1,$2,$3,$4,$5,$6,$7,$8) AS data",
          [
            digestOpaqueSecret(session.token), tenant, store,
            data.orderId, data.kind, data.amountSatang, data.note, this.release(),
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      sqlFailure(error);
    }
  }

  async resolveException(
    req: ApiRequest,
    tenant: string,
    store: string,
    exceptionId: string,
    body: unknown,
  ) {
    scope(tenant, store);
    if (!UUID.test(exceptionId)) {
      throw new NotFoundException("Payment exception unavailable");
    }
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = parse(() => parseExceptionResolution(body));
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.resolve_manual_payment_exception($1,$2,$3,$4,$5,$6,$7) AS data",
          [
            digestOpaqueSecret(session.token), tenant, store,
            exceptionId, data.expectedRevision, data.resolution, this.release(),
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      sqlFailure(error);
    }
  }
}
