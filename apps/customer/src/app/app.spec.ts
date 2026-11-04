import { describe, expect, it } from "vitest";
import { routes } from "./app.routes";
import {
  addToCart,
  changeCartQuantity,
  estimateSatang,
  formatSatang,
  GuestVisit,
  sanitizedVisitToken,
  selectedOptionError,
} from "./guest-order.domain";

const VISIT: GuestVisit = {
  visitId: "visit-1",
  storeId: "store-1",
  tableId: "table-1",
  storeName: "RCAT",
  tableLabel: "โต๊ะ 1",
  expiresAt: "2026-11-05T00:00:00Z",
  categories: [{ id: "food", name: "อาหาร", slug: "food" }],
  products: [
    { id: "p1", categoryId: "food", name: "ข้าว", priceSatang: 10000 },
    { id: "p2", categoryId: "food", name: "น้ำ", priceSatang: 2500 },
  ],
  modifierGroups: [
    {
      id: "g1",
      productId: "p1",
      name: "เครื่องเคียง",
      slug: "extras",
      minSelect: 1,
      maxSelect: 2,
    },
  ],
  modifierOptions: [
    {
      id: "o1",
      productId: "p1",
      groupId: "g1",
      name: "ไข่",
      priceDeltaSatang: 1500,
    },
    {
      id: "o2",
      productId: "p1",
      groupId: "g1",
      name: "ลดข้าว",
      priceDeltaSatang: -1000,
    },
  ],
};

describe("customer route security and QR ordering", () => {
  it("lazy loads mobile guest ordering and order-only tracking routes", () => {
    expect(routes.find((x) => x.path === "order")?.loadComponent).toBeTypeOf(
      "function",
    );
    expect(
      routes.find((x) => x.path === "order/track")?.loadComponent,
    ).toBeTypeOf("function");
    expect(routes.some((route) => route.path?.includes("payment"))).toBe(false);
  });

  it("extracts only an exact, single fragment-only ordering capability", () => {
    const token = "X".repeat(43);
    expect(sanitizedVisitToken("token=" + token)).toBe(token);
    expect(sanitizedVisitToken("token=" + token + "&token=" + token)).toBe(
      null,
    );
    expect(
      sanitizedVisitToken("token=" + token + "&redirect=https://evil.test"),
    ).toBe(null);
    expect(sanitizedVisitToken("token=too-short")).toBe(null);
    expect(sanitizedVisitToken("random=" + token)).toBe(null);
    expect(sanitizedVisitToken(null)).toBe(null);
  });

  it("requires all mandatory option groups before adding items", () => {
    expect(selectedOptionError(VISIT, "p1", [])).toContain("เครื่องเคียง");
    expect(selectedOptionError(VISIT, "p1", ["o1", "o1"])).not.toBe(null);
    expect(selectedOptionError(VISIT, "p1", ["foreign"])).not.toBe(null);
    expect(selectedOptionError(VISIT, "p1", ["o1", "o2"])).toBe(null);
    expect(selectedOptionError(VISIT, "p2", [])).toBe(null);
    expect(() => addToCart(VISIT, [], "p1", [])).toThrow();
  });

  it("normalizes options, coalesces identical cart lines and handles signed satang", () => {
    const first = addToCart(VISIT, [], "p1", ["o2", "o1"]);
    const second = addToCart(VISIT, first, "p1", ["o1", "o2"]);
    expect(second).toEqual([
      { productId: "p1", optionIds: ["o1", "o2"], quantity: 2 },
    ]);
    expect(estimateSatang(VISIT, second)).toBe(21000);
    expect(changeCartQuantity(second, 0, -1)[0]?.quantity).toBe(1);
    expect(changeCartQuantity(first, 0, -1)).toEqual([]);
  });

  it("rejects invalid totals, quantity overflow and overly large carts", () => {
    expect(
      estimateSatang(VISIT, [
        { productId: "missing", optionIds: [], quantity: 1 },
      ]),
    ).toBeNaN();
    expect(() =>
      addToCart(
        VISIT,
        [{ productId: "p2", optionIds: [], quantity: 20 }],
        "p2",
        [],
      ),
    ).toThrow("20 ชิ้น");
    expect(() =>
      changeCartQuantity(
        [{ productId: "p2", optionIds: [], quantity: 20 }],
        0,
        1,
      ),
    ).toThrow();
    expect(() => changeCartQuantity([], 0, 1)).toThrow();
    expect(formatSatang(-1)).toBe("—");
    expect(formatSatang(Number.NaN)).toBe("—");
  });
});
