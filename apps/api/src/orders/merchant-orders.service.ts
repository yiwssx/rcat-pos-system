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
const ORDER_CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
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
  if (
    code === "22023" ||
    code === "22P02" ||
    code === "22007" ||
    code === "22008"
  ) {
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
    rawCursor: unknown,
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
    const cursor =
      rawCursor === undefined
        ? null
        : typeof rawCursor === "string"
          ? ORDER_CURSOR.exec(rawCursor)
          : null;
    if (
      rawCursor !== undefined &&
      (!cursor ||
        Number.isNaN(Date.parse(cursor[1] ?? "")) ||
        new Date(cursor[1] ?? "").toISOString().slice(0, 19) !==
          cursor[1]?.slice(0, 19))
    ) {
      throw new BadRequestException("Invalid Order page cursor");
    }
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{
          data: {
            orders: unknown[];
            hasMore: boolean;
            nextCursor: string | null;
          };
        }>(
          "SELECT rcat_private.merchant_order_inbox_page($1,$2,$3,$4,$5,$6,$7) AS data",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            status,
            limit,
            cursor?.[1] ?? null,
            cursor?.[2] ?? null,
          ],
        ),
      );
      return (
        result.rows[0]?.data ?? {
          orders: [],
          hasMore: false,
          nextCursor: null,
        }
      );
    } catch (error) {
      safeError(error);
    }
  }

  async lookup(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    rawIds: unknown,
  ): Promise<{ orders: unknown[] }> {
    validateIds(tenantId, storeId);
    if (typeof rawIds !== "string" || rawIds.length > 50 * 37 ||
        rawIds.length === 0) {
      throw new BadRequestException("Invalid Order lookup IDs");
    }
    const ids = rawIds.split(",").map((id) => id.toLowerCase());
    if (ids.length < 1 || ids.length > 50 ||
        ids.some((id) => !UUID.test(id)) ||
        new Set(ids).size !== ids.length) {
      throw new BadRequestException("Invalid Order lookup IDs");
    }
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { orders: unknown[] } }>(
          "SELECT rcat_private.merchant_order_lookup_ids($1,$2,$3,$4::uuid[]) AS data",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            ids,
          ],
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
