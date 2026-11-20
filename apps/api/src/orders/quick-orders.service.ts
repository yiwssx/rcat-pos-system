import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";
import { GuestRequestBudgetService } from "../ordering/guest-request-budget.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{16,96}$/;

function boundedText(raw: unknown, max: number, required: boolean): string {
  if (typeof raw !== "string") {
    throw new BadRequestException("Invalid Quick Order context");
  }
  const text = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (
    (required && !text) ||
    Array.from(text).length > max ||
    /[\u0000-\u001f\u007f]/u.test(text)
  ) {
    throw new BadRequestException("Invalid Quick Order context");
  }
  return text;
}

function cartFromBody(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("Invalid Quick Order");
  }
  const body = raw as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => !["guestToken", "orderedBy", "deliverTo", "items"].includes(key),
    ) ||
    typeof body["guestToken"] !== "string"
  ) {
    throw new BadRequestException("Invalid Quick Order");
  }
  let tokenDigest: Buffer;
  try {
    tokenDigest = digestOpaqueSecret(body["guestToken"]);
  } catch {
    throw new NotFoundException("Quick session unavailable");
  }
  const items = body["items"];
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new BadRequestException("Invalid Quick Order items");
  }
  let quantitySum = 0;
  const cartItems = items.map((rawItem: unknown) => {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new BadRequestException("Invalid Quick Order item");
    }
    const item = rawItem as Record<string, unknown>;
    if (
      Object.keys(item).some(
        (key) => !["productId", "quantity", "optionIds", "note"].includes(key),
      ) ||
      typeof item["productId"] !== "string" ||
      !UUID.test(item["productId"]) ||
      typeof item["quantity"] !== "number" ||
      !Number.isSafeInteger(item["quantity"]) ||
      item["quantity"] < 1 ||
      item["quantity"] > 20 ||
      !Array.isArray(item["optionIds"]) ||
      item["optionIds"].length > 32 ||
      item["optionIds"].some(
        (id: unknown) => typeof id !== "string" || !UUID.test(id),
      )
    ) {
      throw new BadRequestException("Invalid Quick Order item");
    }
    const optionIds = (item["optionIds"] as string[]).map((id) =>
      id.toLowerCase(),
    );
    if (new Set(optionIds).size !== optionIds.length) {
      throw new BadRequestException("Duplicate modifier");
    }
    quantitySum += item["quantity"];
    return {
      productId: (item["productId"] as string).toLowerCase(),
      quantity: item["quantity"] as number,
      optionIds: optionIds.sort(),
      note: boundedText(item["note"] ?? "", 240, false),
    };
  });
  if (quantitySum > 100) {
    throw new BadRequestException("Too many products");
  }
  return {
    guestToken: body["guestToken"] as string,
    tokenDigest,
    cart: {
      orderedBy: boundedText(body["orderedBy"], 80, true),
      deliverTo: boundedText(body["deliverTo"], 160, true),
      items: cartItems,
    },
  };
}

function failure(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000") {
    throw new NotFoundException("Quick Order unavailable");
  }
  if (code === "23505") {
    throw new ConflictException("Idempotency key reused with another cart");
  }
  if (code === "P0041") {
    throw new HttpException(
      "Too many Quick Order actions",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (code === "P0004" || code === "P0005" || code === "P0001") {
    throw new ConflictException("Quick Order stock or state changed");
  }
  if (["22023", "22P02", "23514", "23503"].includes(code as string)) {
    throw new BadRequestException("Invalid Quick Order configuration");
  }
  throw error;
}

// Stable across every add-on and retry for this Order, but separate from the
// Store Guest mutation capability and existing Table tracking domain.
function orderTrackingToken(guestToken: string, orderId: string): string {
  return createHmac("sha256", Buffer.from(guestToken, "base64url"))
    .update("rcat-pos-quick-order-tracking:v1\\0")
    .update(orderId.toLowerCase())
    .digest("base64url");
}

/** A printed QR is never an identity or an Order editing credential. */
@Injectable()
export class QuickOrdersService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly guestBudget: GuestRequestBudgetService,
  ) {}

  async submit(
    req: ApiRequest,
    raw: unknown,
    idempotencyKey: string | undefined,
    requestedOrderId: string | null = null,
  ) {
    if (!idempotencyKey || !KEY.test(idempotencyKey)) {
      throw new BadRequestException("Invalid Idempotency-Key");
    }
    if (requestedOrderId !== null && !UUID.test(requestedOrderId)) {
      throw new NotFoundException("Quick Order unavailable");
    }
    const { guestToken, tokenDigest, cart } = cartFromBody(raw);
    await this.guestBudget.consume(req, "checkout", guestToken);
    try {
      return await this.database.auth(async (client) => {
        const result = await client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.quick_order_submit($1,$2,$3::jsonb,$4::uuid) AS data",
          [tokenDigest, idempotencyKey, JSON.stringify(cart), requestedOrderId],
        );
        const order = result.rows[0]?.data;
        if (!order || typeof order["orderId"] !== "string") {
          throw new Error("Quick checkout did not return an Order ID");
        }
        const trackingToken = orderTrackingToken(guestToken, order["orderId"]);
        await client.query(
          "SELECT rcat_private.bind_quick_order_tracking($1,$2,$3)",
          [order["orderId"], tokenDigest, digestOpaqueSecret(trackingToken)],
        );
        return { ...order, trackingToken };
      });
    } catch (error) {
      failure(error);
    }
  }

  async tracking(req: ApiRequest, orderId: string, raw: unknown) {
    if (!UUID.test(orderId)) {
      throw new NotFoundException("Quick Order unavailable");
    }
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 1 ||
      typeof (raw as Record<string, unknown>)["guestToken"] !== "string"
    ) {
      throw new NotFoundException("Quick session unavailable");
    }
    const token = (raw as Record<string, string>)["guestToken"]!;
    await this.guestBudget.consume(req, "resolve", token);
    let digest: Buffer;
    try {
      digest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Quick session unavailable");
    }
    const trackingToken = orderTrackingToken(token, orderId);
    try {
      await this.database.auth((client) =>
        client.query(
          "SELECT rcat_private.bind_quick_order_tracking($1,$2,$3)",
          [orderId, digest, digestOpaqueSecret(trackingToken)],
        ),
      );
      return { orderId: orderId.toLowerCase(), trackingToken };
    } catch (error) {
      failure(error);
    }
  }

  async mine(req: ApiRequest, raw: unknown) {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 1 ||
      typeof (raw as Record<string, unknown>)["guestToken"] !== "string"
    ) {
      throw new NotFoundException("Quick session unavailable");
    }
    const token = (raw as Record<string, string>)["guestToken"]!;
    await this.guestBudget.consume(req, "resolve", token);
    let digest: Buffer;
    try {
      digest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Quick session unavailable");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.quick_order_my_orders($1) AS data",
          [digest],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      failure(error);
    }
  }
}
