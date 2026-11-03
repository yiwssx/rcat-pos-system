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
const STATUSES = new Set([
  "submitted",
  "accepted",
  "preparing",
  "served",
  "cancelled",
]);

function validateIds(...ids: string[]): void {
  if (ids.some((id) => !UUID.test(id))) {
    throw new NotFoundException("Order unavailable");
  }
}

function safeError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000") {
    throw new NotFoundException("Order unavailable");
  }
  if (code === "P0001") {
    throw new ConflictException("Order status has changed");
  }
  if (code === "22023" || code === "22P02") {
    throw new BadRequestException("Invalid order operation");
  }
  throw error;
}

@Injectable()
export class MerchantOrdersService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async inbox(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    rawStatus: unknown,
    rawLimit: unknown,
  ) {
    validateIds(tenantId, storeId);
    const status = rawStatus === undefined ? null : rawStatus;
    if (
      status !== null &&
      (typeof status !== "string" || !STATUSES.has(status))
    ) {
      throw new BadRequestException("Invalid order status filter");
    }
    const limit = rawLimit === undefined ? 25 : Number(rawLimit);
    if (
      (rawLimit !== undefined &&
        (typeof rawLimit !== "string" ||
          !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit))) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      throw new BadRequestException("Invalid order limit");
    }
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { orders: unknown[] } }>(
          "SELECT rcat_private.merchant_order_inbox($1,$2,$3,$4,$5) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId, status, limit],
        ),
      );
      return result.rows[0]?.data ?? { orders: [] };
    } catch (error) {
      safeError(error);
    }
  }

  async transition(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    orderId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId, orderId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestException("Invalid order transition");
    }
    const body = raw as Record<string, unknown>;
    const expected = body["expectedStatus"];
    const next = body["nextStatus"];
    if (
      typeof expected !== "string" ||
      typeof next !== "string" ||
      !STATUSES.has(expected) ||
      !STATUSES.has(next)
    ) {
      throw new BadRequestException("Invalid order transition");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.transition_merchant_order($1,$2,$3,$4,$5,$6) AS data",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            orderId,
            expected,
            next,
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      safeError(error);
    }
  }

  async history(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    orderId: string,
  ) {
    validateIds(tenantId, storeId, orderId);
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.merchant_order_history($1,$2,$3,$4) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId, orderId],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      safeError(error);
    }
  }
}
