import { describe, expect, it } from "vitest";
import { hasMerchantPermission } from "./permissions";

describe("minimum merchant role permission defaults", () => {
  it("allows an owner to manage store and staff", () => {
    expect(hasMerchantPermission("owner", "staff.manage")).toBe(true);
    expect(hasMerchantPermission("owner", "store.manage")).toBe(true);
  });

  it("denies store, staff and audit administration to kitchen/cashier", () => {
    expect(hasMerchantPermission("kitchen", "order.fulfill")).toBe(true);
    expect(hasMerchantPermission("kitchen", "staff.manage")).toBe(false);
    expect(hasMerchantPermission("cashier", "audit.read")).toBe(false);
    expect(hasMerchantPermission("cashier", "order.cancel")).toBe(false);
  });

  it("does not implicitly give manager ownership-level privileges", () => {
    expect(hasMerchantPermission("manager", "staff.manage")).toBe(false);
    expect(hasMerchantPermission("manager", "catalog.manage")).toBe(true);
  });
});
