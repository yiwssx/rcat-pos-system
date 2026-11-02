export type MerchantRole = "owner" | "manager" | "cashier" | "kitchen";
export type MerchantPermission =
  | "store.read"
  | "store.manage"
  | "catalog.manage"
  | "order.read"
  | "order.fulfill"
  | "order.cancel"
  | "staff.manage"
  | "audit.read";

type RolePermissionMap = Readonly<
  Record<MerchantRole, readonly MerchantPermission[]>
>;

const PERMISSIONS: RolePermissionMap = {
  owner: [
    "store.read",
    "store.manage",
    "catalog.manage",
    "order.read",
    "order.fulfill",
    "order.cancel",
    "staff.manage",
    "audit.read",
  ],
  manager: [
    "store.read",
    "catalog.manage",
    "order.read",
    "order.fulfill",
    "order.cancel",
  ],
  cashier: ["store.read", "order.read"],
  kitchen: ["order.read", "order.fulfill"],
};

export function hasMerchantPermission(
  role: MerchantRole,
  permission: MerchantPermission,
): boolean {
  return PERMISSIONS[role].includes(permission);
}
