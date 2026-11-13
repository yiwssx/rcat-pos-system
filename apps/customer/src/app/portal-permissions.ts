import type {
  MerchantRole,
  MerchantStore,
} from "../../../merchant/src/app/order-board.domain";
export function permitsRoute(
  stores: readonly MerchantStore[],
  kind: string,
  tenant?: string,
  store?: string,
): boolean {
  if (kind === "settings")
    return stores.length === 0 || stores.some((item) => item.role === "owner");
  const roles: Record<string, readonly MerchantRole[]> = {
    orders: ["owner", "manager", "cashier", "kitchen"],
    catalog: ["owner", "manager"],
    tables: ["owner", "manager"],
    reports: ["owner", "manager"],
    inventory: ["owner", "manager", "kitchen"],
    staff: ["owner"],
  };
  return stores.some(
    (item) =>
      item.tenantId === tenant &&
      (!store || item.storeId === store) &&
      (roles[kind] ?? []).includes(item.role),
  );
}
