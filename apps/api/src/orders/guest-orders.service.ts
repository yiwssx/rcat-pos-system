import { createHmac } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { DatabaseAccess } from "../database/db-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{16,96}$/;

function parseCart(raw: unknown): {
  visitDigest: Buffer;
  visitToken: string;
  cart: {
    items: { productId: string; quantity: number; optionIds: string[] }[];
  };
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("Invalid order");
  }
  const body = raw as Record<string, unknown>;
  if (typeof body["visitToken"] !== "string") {
    throw new NotFoundException("Ordering visit unavailable");
  }
  let digest: Buffer;
  try {
    digest = digestOpaqueSecret(body["visitToken"]);
  } catch {
    throw new NotFoundException("Ordering visit unavailable");
  }
  if (
    !Array.isArray(body["items"]) ||
    body["items"].length < 1 ||
    body["items"].length > 20
  ) {
    throw new BadRequestException("Invalid order items");
  }
  let totalQuantity = 0;
  const items = body["items"].map((rawItem: unknown) => {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new BadRequestException("Invalid order item");
    }
    const item = rawItem as Record<string, unknown>;
    const productId = item["productId"];
    const quantity = item["quantity"];
    const optionIds = item["optionIds"];
    if (
      typeof productId !== "string" ||
      !UUID.test(productId) ||
      typeof quantity !== "number" ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 20 ||
      !Array.isArray(optionIds) ||
      optionIds.length > 32 ||
      optionIds.some((id) => typeof id !== "string" || !UUID.test(id))
    ) {
      throw new BadRequestException("Invalid order item or options");
    }
    totalQuantity += quantity;
    const options = optionIds as string[];
    if (
      new Set(options.map((id) => id.toLowerCase())).size !== options.length
    ) {
      throw new BadRequestException("Duplicate option");
    }
    return {
      productId: productId.toLowerCase(),
      quantity,
      optionIds: options.map((id) => id.toLowerCase()).sort(),
    };
  });
  if (totalQuantity > 100) {
    throw new BadRequestException("Too many products");
  }
  // Never accept client prices, state, tenant_id or payment fields as authority.
  return {
    visitDigest: digest,
    visitToken: body["visitToken"],
    cart: { items },
  };
}

function mapOrderFailure(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000") {
    throw new NotFoundException("Order or visit unavailable");
  }
  if (code === "23505") {
    throw new ConflictException(
      "Idempotency key already used for another cart",
    );
  }
  if (
    code === "22023" ||
    code === "23514" ||
    code === "23503" ||
    code === "22P02"
  ) {
    throw new BadRequestException("Invalid order configuration");
  }
  throw error;
}

@Injectable()
export class GuestOrdersService {
  constructor(private readonly database: DatabaseAccess) {}

  async place(raw: unknown, key: string | undefined) {
    if (!key || !KEY.test(key)) {
      throw new BadRequestException("Invalid Idempotency-Key");
    }
    const { visitDigest, visitToken, cart } = parseCart(raw);
    // The table-visit secret AND unpredictable retry-stable checkout key are
    // required to derive an order-only bearer. No new server-wide key and no
    // raw tracking secrets are stored in the database.
    const trackingToken = createHmac(
      "sha256",
      Buffer.from(visitToken, "base64url"),
    )
      .update("rcat-pos-order-tracking:v1\\0")
      .update(key)
      .digest("base64url");
    const trackingDigest = digestOpaqueSecret(trackingToken);
    try {
      const data = await this.database.auth(async (client) => {
        const result = await client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.place_guest_order($1,$2,$3::jsonb) AS data",
          [visitDigest, key, JSON.stringify(cart)],
        );
        const order = result.rows[0]?.data;
        if (!order || typeof order["orderId"] !== "string") {
          throw new Error("Checkout did not return an Order ID");
        }
        // Same transaction as checkout; failure rolls the entire Order back.
        await client.query(
          "SELECT rcat_private.bind_guest_order_tracking($1,$2,$3,$4)",
          [order["orderId"], visitDigest, key, trackingDigest],
        );
        return order;
      });
      return { ...data, trackingToken };
    } catch (error) {
      mapOrderFailure(error);
    }
  }

  async status(orderId: string, authorization: string | undefined) {
    if (!UUID.test(orderId)) {
      throw new NotFoundException("Order unavailable");
    }
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "")?.[1];
    if (!token) {
      throw new NotFoundException("Order unavailable");
    }
    let trackingDigest: Buffer;
    try {
      trackingDigest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Order unavailable");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.guest_order_status($1,$2) AS data",
          [orderId, trackingDigest],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mapOrderFailure(error);
    }
  }
}
