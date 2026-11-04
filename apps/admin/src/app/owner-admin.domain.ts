export type StaffRole = "owner" | "manager" | "cashier" | "kitchen";
export type InvitableRole = Exclude<StaffRole, "owner">;

export interface AdminStore {
  tenantId: string;
  storeId: string;
  tenantName: string;
  storeName: string;
  role: StaffRole;
}

export interface StaffMember {
  user_id: string;
  role: StaffRole;
}

export interface MerchantCreation {
  tenantSlug: string;
  tenantName: string;
  storeSlug: string;
  storeName: string;
}

export const STAFF_ROLE_LABEL: Readonly<Record<StaffRole, string>> = {
  owner: "เจ้าของร้าน",
  manager: "ผู้จัดการ",
  cashier: "แคชเชียร์",
  kitchen: "พนักงานครัว",
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAFF_EMAIL = /^[^\s@]+@rcat\.ac\.th$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validMerchantCreation(input: MerchantCreation): string | null {
  const slugs = [input.tenantSlug, input.storeSlug];
  if (slugs.some((slug) => !SLUG.test(slug) || slug.length < 3 || slug.length > 48)) {
    return "รหัสร้าน/หน่วยงานต้องเป็น a-z, 0-9 หรือขีดกลาง และยาว 3–48 อักขระ";
  }
  if ([input.tenantName, input.storeName].some((name) =>
    name.trim().length < 1 || name.trim().length > 160)) {
    return "ชื่อหน่วยงาน/ร้านค้าต้องมีความยาว 1–160 อักขระ";
  }
  return null;
}

export function normalizeStaffEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && STAFF_EMAIL.test(email) ? email : null;
}

export function validInviteRole(role: string): role is InvitableRole {
  return role === "manager" || role === "cashier" || role === "kitchen";
}

export function validInvitationToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function validScopeId(id: string): boolean {
  return UUID.test(id);
}

export function canManageStaff(role: StaffRole): boolean {
  return role === "owner";
}

export function tenantAdminPath(tenantId: string): string {
  return "/api/tenants/" + encodeURIComponent(tenantId);
}

export function shortStaffId(value: string): string {
  return UUID.test(value) ? value.slice(0, 8) + "…" + value.slice(-4) : "—";
}
