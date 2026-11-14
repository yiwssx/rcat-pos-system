import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { AuthService } from "../auth/auth.service";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000") {
    throw new NotFoundException("Payment settings unavailable");
  }
  if (code === "P0009") {
    throw new ConflictException("Receiver changed; reload settings");
  }
  if (code === "22023" || code === "23514" || code === "22P02") {
    throw new BadRequestException("Invalid PromptPay receiver");
  }
  throw error;
}

function form(raw: unknown): {
  receiverKind: "mobile" | "national_id";
  receiverId: string;
  expectedRevision: number;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("Invalid payment settings request");
  }
  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(",");
  if (keys !== "expectedRevision,receiverId,receiverKind") {
    throw new BadRequestException("Invalid payment settings request");
  }
  const receiverKind = input["receiverKind"];
  const receiverId = input["receiverId"];
  const expectedRevision = input["expectedRevision"];
  if (
    (receiverKind !== "mobile" && receiverKind !== "national_id") ||
    typeof receiverId !== "string" ||
    !(
      (receiverKind === "mobile" && /^0[689][0-9]{8}$/.test(receiverId)) ||
      (receiverKind === "national_id" && /^[0-9]{13}$/.test(receiverId))
    ) ||
    typeof expectedRevision !== "number" ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision > 2147483646
  ) {
    throw new BadRequestException("Invalid payment settings request");
  }
  return { receiverKind, receiverId, expectedRevision };
}

@Injectable()
export class MerchantPaymentReceiverService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async settings(req: ApiRequest, tenantId: string, storeId: string) {
    if (!UUID.test(tenantId) || !UUID.test(storeId)) {
      throw new NotFoundException("Payment settings unavailable");
    }
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.merchant_promptpay_receiver($1,$2,$3) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      safeError(error);
    }
  }

  async configure(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    if (!UUID.test(tenantId) || !UUID.test(storeId)) {
      throw new NotFoundException("Payment settings unavailable");
    }
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    // Never accept `enabled` or any user-provided tenant, amount or Order state.
    const data = form(raw);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.set_merchant_promptpay_receiver($1,$2,$3,$4,$5,$6) AS data",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            data.receiverKind,
            data.receiverId,
            data.expectedRevision,
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      safeError(error);
    }
  }
}
