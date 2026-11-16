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
  it("exposes existing Payment views through guarded single-entry routes", () => {
    for (const path of [
      "payments/receiver/:tenantId/:storeId",
      "payments/:tenantId/:storeId",
      "payments/finance/:tenantId/:storeId",
    ]) {
      const route = routes.find((candidate) => candidate.path === path);
      expect(route?.data?.["permission"]).toBe("payments");
      expect(route?.canActivate).toContain(portalAccess);
      expect(route?.loadComponent).toBeTypeOf("function");
    }
  });
  it("restricts Payment navigation to authorized owner/manager per store", () => {
    const owner = { ...store, role: "owner" as const };
    const manager = { ...store, role: "manager" as const };
    expect(permitsRoute([], "payments", "tenant-a", "store-a")).toBe(false);
    expect(permitsRoute([store], "payments", "tenant-a", "store-a")).toBe(false);
    expect(permitsRoute([{ ...store, role: "kitchen" }], "payments", "tenant-a", "store-a")).toBe(false);
    expect(permitsRoute([owner], "payments", "tenant-a", "store-a")).toBe(true);
    expect(permitsRoute([manager], "payments", "tenant-a", "store-a")).toBe(true);
    expect(permitsRoute([owner], "payments", "tenant-b", "store-a")).toBe(false);
    expect(permitsRoute([owner], "payments", "tenant-a", "store-b")).toBe(false);
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
