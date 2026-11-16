import "@angular/compiler";
import { describe, expect, it } from "vitest";
import { permitsRoute } from "./portal-permissions";
import { routes } from "./app.routes";
import { portalAccess } from "./portal-access";
import type { MerchantStore } from "../../../merchant/src/app/order-board.domain";
const store: MerchantStore = {
  tenantId: "tenant-a",
  storeId: "store-a",
  tenantName: "A",
  storeName: "A",
  role: "cashier",
};
describe("single-entry route permissions", () => {
  it("does not grant staff privileges from a guessed URL or a different store", () => {
    expect(permitsRoute([], "orders", "tenant-a", "store-a")).toBe(false);
    expect(permitsRoute([store], "orders", "tenant-a", "store-a")).toBe(true);
    expect(permitsRoute([store], "orders", "tenant-b", "store-a")).toBe(false);
    expect(permitsRoute([store], "orders", "tenant-a", "store-b")).toBe(false);
    expect(permitsRoute([store], "staff", "tenant-a")).toBe(false);
    expect(permitsRoute([store], "settings")).toBe(false);
    expect(permitsRoute([store], "catalog", "tenant-a", "store-a")).toBe(false);
  });
  it("guards Payment pages in the customer portal", () => {
    const pages = routes.filter((route) => route.path?.startsWith("payments/"));
    expect(pages).toHaveLength(3);
    for (const page of pages) {
      expect(page.canActivate).toContain(portalAccess);
      expect(page.data?.["permission"]).toBe("payments");
    }
  });
  it("limits Payment access to the correct store and role", () => {
    const owner = [{ ...store, role: "owner" as const }];
    const allowed = (role: MerchantStore["role"]) =>
      permitsRoute([{ ...store, role }], "payments", "tenant-a", "store-a");
    expect(allowed("owner")).toBe(true);
    expect(allowed("manager")).toBe(true);
    expect(allowed("cashier")).toBe(false);
    expect(allowed("kitchen")).toBe(false);
    expect(permitsRoute(owner, "payments", "tenant-b", "store-a")).toBe(false);
    expect(permitsRoute(owner, "payments", "tenant-a", "store-b")).toBe(false);
  });
  it("keeps owner, manager and kitchen capabilities distinct", () => {
    expect(
      permitsRoute([{ ...store, role: "owner" }], "staff", "tenant-a"),
    ).toBe(true);
    expect(
      permitsRoute([{ ...store, role: "manager" }], "staff", "tenant-a"),
    ).toBe(false);
    expect(
      permitsRoute(
        [{ ...store, role: "manager" }],
        "tables",
        "tenant-a",
        "store-a",
      ),
    ).toBe(true);
    expect(
      permitsRoute(
        [{ ...store, role: "kitchen" }],
        "orders",
        "tenant-a",
        "store-a",
      ),
    ).toBe(true);
    expect(
      permitsRoute(
        [{ ...store, role: "kitchen" }],
        "reports",
        "tenant-a",
        "store-a",
      ),
    ).toBe(false);
  });
});
