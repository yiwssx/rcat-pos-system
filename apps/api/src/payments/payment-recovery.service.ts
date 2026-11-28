import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  digestOpaqueSecret,
  newOpaqueSecret,
} from "../../../../libs/server-auth/src";
import { AuthService } from "../auth/auth.service";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";
import { GuestRequestBudgetService } from "../ordering/guest-request-budget.service";

import { record, validateRecoveryIssue } from "./payment-recovery.core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function unavailable(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (["42501", "28000", "22P02", "23505"].includes(String(code))) {
    throw new NotFoundException("Payment recovery unavailable");
  }
  if (code === "P0009") {
    throw new ConflictException("Order or payment availability changed");
  }
  if (code === "22023" || code === "23514") {
    throw new BadRequestException("Invalid payment recovery request");
  }
  throw error;
}

@Injectable()
export class PaymentRecoveryService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
    private readonly budget: GuestRequestBudgetService,
  ) {}

  async issue(
    req: ApiRequest,
    tenant: string,
    store: string,
    order: string,
    raw: unknown,
  ) {
    if (![tenant, store, order].every((id) => UUID.test(id))) {
      throw new NotFoundException("Payment recovery unavailable");
    }
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const input = validateRecoveryIssue(raw);
    // Raw claim returned only once to this authorized merchant. Never log or
    // store it; a reissue replaces the prior recovery, not original tracking.
    const claimToken = newOpaqueSecret();
    try {
      const result = await this.database.auth((client) =>
        client.query<{
          data: {
            orderId: string;
            displayNumber: string;
            claimExpiresAt: string;
          };
        }>(
          "SELECT rcat_private.merchant_issue_order_payment_recovery($1,$2,$3,$4,$5,$6,$7,$8,$9) AS data",
          [
            digestOpaqueSecret(session.token),
            tenant,
            store,
            order,
            input.expectedState,
            input.expectedAmountSatang,
            true,
            digestOpaqueSecret(claimToken),
            process.env["RCAT_POS_PAYMENT_QR_RELEASE_APPROVED"] === "true" &&
              process.env["RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED"] === "true",
          ],
        ),
      );
      return { ...result.rows[0]!.data, claimToken };
    } catch (error) {
      unavailable(error);
    }
  }

  async revoke(req: ApiRequest, tenant: string, store: string, order: string) {
    if (![tenant, store, order].every((id) => UUID.test(id))) {
      throw new NotFoundException("Payment recovery unavailable");
    }
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: unknown }>(
          "SELECT rcat_private.merchant_revoke_order_payment_recovery($1,$2,$3,$4) AS data",
          [digestOpaqueSecret(session.token), tenant, store, order],
        ),
      );
      return result.rows[0]!.data;
    } catch (error) {
      unavailable(error);
    }
  }

  async redeem(req: ApiRequest, order: string, raw: unknown) {
    const data = record(raw);
    const claim = data["claimToken"];
    const access = data["accessToken"];
    if (
      !UUID.test(order) ||
      Object.keys(data).sort().join(",") !== "accessToken,claimToken" ||
      typeof claim !== "string" ||
      typeof access !== "string" ||
      !TOKEN.test(claim) ||
      !TOKEN.test(access) ||
      claim === access
    ) {
      throw new NotFoundException("Payment recovery unavailable");
    }
    await this.budget.consume(req, "redeem", claim);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: unknown }>(
          "SELECT rcat_private.guest_redeem_order_payment_recovery($1,$2,$3) AS data",
          [order, digestOpaqueSecret(claim), digestOpaqueSecret(access)],
        ),
      );
      return result.rows[0]!.data;
    } catch (error) {
      unavailable(error);
    }
  }
}
