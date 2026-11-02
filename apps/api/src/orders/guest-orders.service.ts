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
  return { visitDigest: digest, cart: { items } };
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
    const { visitDigest, cart } = parseCart(raw);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.place_guest_order($1,$2,$3::jsonb) AS data",
          [visitDigest, key, JSON.stringify(cart)],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mapOrderFailure(error);
    }
  }
}
