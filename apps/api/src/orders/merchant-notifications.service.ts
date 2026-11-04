import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { AuthService } from "../auth/auth.service";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";

export interface MerchantNotificationEvent {
  eventId: string;
  eventType: "order.submitted" | "order.status.changed";
  orderId: string;
  tableId: string;
  status: "submitted" | "accepted" | "preparing" | "served" | "cancelled";
  previousStatus: string | null;
  occurredAt: string;
}

export interface MerchantNotificationPage {
  events: MerchantNotificationEvent[];
  nextCursor: string;
  acknowledgedCursor: string;
  hasMore: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^(?:0|[1-9][0-9]{0,18})$/;
const MAX_BIGINT = 9223372036854775807n;

function validateScope(tenantId: string, storeId: string): void {
  if (!UUID.test(tenantId) || !UUID.test(storeId)) {
    throw new NotFoundException("Notifications unavailable");
  }
}

function parseCursor(raw: unknown, nullable: boolean): string | null {
  if (nullable && raw === undefined) return null;
  if (
    typeof raw !== "string" ||
    !CURSOR.test(raw) ||
    BigInt(raw) > MAX_BIGINT
  ) {
    throw new BadRequestException("Invalid notification cursor");
  }
  return raw;
}

function mapFailure(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000") {
    throw new NotFoundException("Notifications unavailable");
  }
  if (code === "22023" || code === "22P02") {
    throw new BadRequestException("Invalid notification request");
  }
  throw error;
}

@Injectable()
export class MerchantNotificationsService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async list(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    rawAfter: unknown,
    rawLimit: unknown,
  ): Promise<MerchantNotificationPage> {
    validateScope(tenantId, storeId);
    const after = parseCursor(rawAfter, true);
    const limit = rawLimit === undefined ? 25 : Number(rawLimit);
    if (
      (rawLimit !== undefined &&
        (typeof rawLimit !== "string" ||
          !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit))) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      throw new BadRequestException("Invalid notification limit");
    }
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: MerchantNotificationPage }>(
          "SELECT rcat_private.merchant_order_notifications($1,$2,$3,$4,$5) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId, after, limit],
        ),
      );
      const data = result.rows[0]?.data;
      if (!data) {
        throw new ServiceUnavailableException("Notifications unavailable");
      }
      return data;
    } catch (error) {
      mapFailure(error);
    }
  }

  async acknowledge(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    validateScope(tenantId, storeId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestException("Invalid notification acknowledgement");
    }
    const eventId = parseCursor(
      (raw as Record<string, unknown>)["eventId"],
      false,
    );
    if (eventId === "0") {
      throw new BadRequestException("Invalid notification acknowledgement");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { acknowledgedCursor: string } }>(
          "SELECT rcat_private.ack_merchant_order_notification($1,$2,$3,$4) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId, eventId],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mapFailure(error);
    }
  }
}
