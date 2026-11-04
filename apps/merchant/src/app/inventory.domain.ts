export type InventoryUnit = "g" | "ml" | "unit";
export type InventoryKind =
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
  kind: InventoryKind;
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
export interface CatalogProducts {
  products: { id: string; name: string; available: boolean }[];
  modifierOptions: {
    id: string;
    productId: string;
    groupId: string;
    name: string;
  }[];
}

const DECIMAL = /^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,3})?$/;
export function toMilliUnits(input: string): bigint | null {
  const negative = input.startsWith("-");
  const value = negative ? input.slice(1) : input;
  if (!DECIMAL.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  const scaled = BigInt(whole) * 1000n + BigInt(decimal.padEnd(3, "0"));
  return negative ? -scaled : scaled;
}
export function formatUnits(input: string): string {
  const scaled = toMilliUnits(input);
  if (scaled === null) return "—";
  const abs = scaled < 0 ? -scaled : scaled;
  const whole = abs / 1000n;
  const frac = String(abs % 1000n)
    .padStart(3, "0")
    .replace(/0+$/, "");
  const prefix = scaled < 0 ? "-" : "";
  return (
    prefix +
    new Intl.NumberFormat("th-TH").format(whole) +
    (frac ? "." + frac : "")
  );
}
export function lowStock(item: InventoryItem): boolean {
  const onHand = toMilliUnits(item.onHand);
  const threshold = toMilliUnits(item.reorderAt);
  return onHand !== null && threshold !== null && onHand <= threshold;
}
export function validStockInput(
  input: string,
  options: { negative?: boolean; zero?: boolean; max?: bigint } = {},
): boolean {
  const value = toMilliUnits(input);
  return (
    value !== null &&
    (options.negative || value >= 0n) &&
    (options.zero || value !== 0n) &&
    value <= (options.max ?? 1000000000n) * 1000n &&
    value >= -(options.max ?? 1000000000n) * 1000n
  );
}
export function inventoryPath(tenantId: string, storeId: string): string {
  return (
    "/api/tenants/" +
    encodeURIComponent(tenantId) +
    "/stores/" +
    encodeURIComponent(storeId) +
    "/inventory"
  );
}
