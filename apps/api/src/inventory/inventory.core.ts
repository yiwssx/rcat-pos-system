// All stock quantities are fixed-point DECIMAL strings, never JS floats.
// g/ml/unit are the only supported unit labels in this foundation.
const DECIMAL = /^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,3})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type InventoryUnit = "g" | "ml" | "unit";
export type InventoryMovementKind =
  "receipt" | "adjustment" | "order_consumption" | "order_return";

export interface InventoryItem {
  itemId: string;
  name: string;
  unit: InventoryUnit;
  onHand: string;
  reorderAt: string;
}
export interface InventoryRecipe {
  productId: string;
  productName: string;
  itemId: string;
  quantityPerProduct: string;
}
export interface InventoryMovement {
  movementId: string;
  itemId: string;
  kind: InventoryMovementKind;
  delta: string;
  quantityAfter: string;
  reason: string;
  createdAt: string;
}
export interface InventorySnapshot {
  items: InventoryItem[];
  recipes: InventoryRecipe[];
  recentMovements: InventoryMovement[];
  stockMode: "manual_ledger_only" | "order_acceptance_opt_in";
  orderConsumptionEnabled: boolean;
  trackedProducts: { productId: string; productName: string }[];
  modifierRecipes: {
    optionId: string;
    productId: string;
    itemId: string;
    quantityPerProduct: string;
  }[];
}
export interface InventoryCreateItem {
  name: string;
  unit: InventoryUnit;
  reorderAt: string;
}
export interface InventoryNewMovement {
  itemId: string;
  idempotencyKey: string;
  kind: InventoryMovementKind;
  delta: string;
  reason: string;
}

export function validInventoryId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
export function validQuantity(
  value: unknown,
  max: bigint,
  allowNegative = false,
  allowZero = true,
): value is string {
  if (typeof value !== "string") return false;
  const negative = value.startsWith("-");
  if (negative && !allowNegative) return false;
  const unsigned = negative ? value.slice(1) : value;
  if (!DECIMAL.test(unsigned)) return false;
  const [whole, part = ""] = unsigned.split(".");
  const units = BigInt(whole) * 1000n + BigInt(part.padEnd(3, "0"));
  return (allowZero || units > 0n) && units <= max * 1000n;
}
export function validateItem(raw: unknown): InventoryCreateItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  if (
    typeof item["name"] !== "string" ||
    item["name"].trim().length < 1 ||
    item["name"].trim().length > 120 ||
    !["g", "ml", "unit"].includes(String(item["unit"])) ||
    !validQuantity(item["reorderAt"], 1000000000000n)
  )
    return null;
  return {
    name: item["name"].trim(),
    unit: item["unit"] as InventoryUnit,
    reorderAt: item["reorderAt"],
  };
}
export function validateMovement(raw: unknown): InventoryNewMovement | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (
    !validInventoryId(body["itemId"]) ||
    !validInventoryId(body["idempotencyKey"]) ||
    (body["kind"] !== "receipt" && body["kind"] !== "adjustment") ||
    !validQuantity(
      body["delta"],
      1000000000n,
      body["kind"] === "adjustment",
      false,
    ) ||
    typeof body["reason"] !== "string" ||
    body["reason"].trim().length < 3 ||
    body["reason"].trim().length > 200
  )
    return null;
  return {
    itemId: body["itemId"],
    idempotencyKey: body["idempotencyKey"],
    kind: body["kind"],
    delta: body["delta"],
    reason: body["reason"].trim(),
  };
}
export function validRecipeQuantity(raw: unknown): raw is string {
  return validQuantity(raw, 1000000000n, false, true);
}

export interface NewStocktake {
  itemId: string;
  idempotencyKey: string;
}
export interface SubmittedStocktakeCount {
  countedOnHand: string;
  reason: string;
}
export interface ReviewedStocktake {
  approve: boolean;
}

export function validateNewStocktake(raw: unknown): NewStocktake | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (
    !validInventoryId(body["itemId"]) ||
    !validInventoryId(body["idempotencyKey"])
  )
    return null;
  return {
    itemId: body["itemId"],
    idempotencyKey: body["idempotencyKey"],
  };
}

export function validateSubmittedStocktake(
  raw: unknown,
): SubmittedStocktakeCount | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (
    !validQuantity(body["countedOnHand"], 1000000000000n) ||
    typeof body["reason"] !== "string" ||
    body["reason"].trim().length < 3 ||
    body["reason"].trim().length > 200
  )
    return null;
  return {
    countedOnHand: body["countedOnHand"],
    reason: body["reason"].trim(),
  };
}

export function validateReviewedStocktake(
  raw: unknown,
): ReviewedStocktake | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const approve = (raw as Record<string, unknown>)["approve"];
  return typeof approve === "boolean" ? { approve } : null;
}

export type ExceptionReturnCategory =
  | "unused_unopened"
  | "kitchen_error_unconsumed";

export interface ExceptionReturnRequest {
  itemId: string;
  idempotencyKey: string;
  quantity: string;
  category: ExceptionReturnCategory;
  reason: string;
}

export function validateExceptionReturnRequest(raw: unknown): ExceptionReturnRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (
    !validInventoryId(body["itemId"]) ||
    !validInventoryId(body["idempotencyKey"]) ||
    !validQuantity(body["quantity"], 1000000000n, false, false) ||
    (body["category"] !== "unused_unopened" &&
      body["category"] !== "kitchen_error_unconsumed") ||
    typeof body["reason"] !== "string" ||
    body["reason"].trim().length < 10 ||
    body["reason"].trim().length > 200
  )
    return null;
  return {
    itemId: body["itemId"],
    idempotencyKey: body["idempotencyKey"],
    quantity: body["quantity"],
    category: body["category"],
    reason: body["reason"].trim(),
  };
}
