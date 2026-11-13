import "@angular/compiler";
import { describe, expect, it } from "vitest";
import { permitsRoute } from "./portal-permissions";
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
