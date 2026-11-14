import "@angular/compiler";
import { describe, expect, it } from "vitest";
import { routes } from "./app.routes";
import {
  addToCart,
  changeCartQuantity,
  changeModifierSelection,
  cartNeedsReview,
  estimateSatang,
  formatSatang,
  filterGuestMenu,
  GUEST_MENU_BATCH_SIZE,
  mergeCartReview,
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

  it("filters Thai product catalogs deterministically without changing the server visit", () => {
    const products = Array.from({ length: 70 }, (_, i) => ({
      id: "item-" + String(i).padStart(3, "0"),
      categoryId: i < 50 ? "food" : "drink",
      name: i === 61 ? "ชาไทยพิเศษ" : "สินค้า " + i,
      priceSatang: 1500,
    }));
    const large: GuestVisit = { ...VISIT, products };
    const all = filterGuestMenu(large, "", "");
    expect(all).toHaveLength(70);
    expect(all.slice(0, GUEST_MENU_BATCH_SIZE)).toHaveLength(24);
    expect(all.slice(0, 48).map((p) => p.id)).toEqual(
      products.slice(0, 48).map((p) => p.id),
    );
    expect(filterGuestMenu(large, "  ชาไทย  ", "")).toEqual([products[61]]);
    expect(filterGuestMenu(large, "", "drink")).toHaveLength(20);
    expect(filterGuestMenu(large, "สินค้า 1", "drink")).toEqual([]);
    expect(large.products).toHaveLength(70);
    expect(GUEST_MENU_BATCH_SIZE).toBe(24);
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

  it("uses radio semantics for required and optional single-select modifier groups", () => {
    const visit: GuestVisit = {
      ...VISIT,
      modifierGroups: [
        ...VISIT.modifierGroups,
        {
          id: "sweet",
          productId: "p1",
          name: "ระดับความหวาน",
          slug: "sweet",
          minSelect: 1,
          maxSelect: 1,
        },
        {
          id: "ice",
          productId: "p1",
          name: "น้ำแข็ง",
          slug: "ice",
          minSelect: 0,
          maxSelect: 1,
        },
      ],
      modifierOptions: [
        ...VISIT.modifierOptions,
        {
          id: "sweet-low",
          productId: "p1",
          groupId: "sweet",
          name: "หวานน้อย",
          priceDeltaSatang: 0,
        },
        {
          id: "sweet-high",
          productId: "p1",
          groupId: "sweet",
          name: "หวานมาก",
          priceDeltaSatang: 0,
        },
        {
          id: "ice-on",
          productId: "p1",
          groupId: "ice",
          name: "เพิ่มน้ำแข็ง",
          priceDeltaSatang: 500,
        },
      ],
    };
    function choose(
      groupId: string,
      selectedIds: string[],
      optionId: string | null,
    ): string[] {
      return changeModifierSelection(visit, "p1", groupId, selectedIds, optionId);
    }
    const first = choose("sweet", ["o1"], "sweet-low");
    expect(first).toEqual(["o1", "sweet-low"]);
    const switched = choose("sweet", first, "sweet-high");
    expect(switched).toEqual(["o1", "sweet-high"]);
    expect(selectedOptionError(visit, "p1", switched)).toBe(null);
    const withIce = choose("ice", switched, "ice-on");
    const items = [{ productId: "p1", optionIds: withIce, quantity: 1 }];
    expect(estimateSatang(visit, items)).toBe(12000);
    expect(choose("ice", withIce, null)).toEqual(switched);
    expect(() => choose("sweet", switched, null)).toThrow();
    expect(() => choose("sweet", switched, "foreign")).toThrow();
  });

  it("keeps multi-select modifiers independently bounded", () => {
    const first = changeModifierSelection(VISIT, "p1", "g1", [], "o1");
    const second = changeModifierSelection(VISIT, "p1", "g1", first, "o2");
    expect(second).toEqual(["o1", "o2"]);
    const removed = changeModifierSelection(VISIT, "p1", "g1", second, "o1");
    expect(removed).toEqual(["o2"]);
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

  it("reconfirms renamed products, category labels and option names even at unchanged totals", () => {
    const cart = [{ productId: "p1", optionIds: ["o1"], quantity: 1 }];
    expect(cartNeedsReview(VISIT, VISIT, cart)).toBe(false);
    expect(
      cartNeedsReview(
        VISIT,
        {
          ...VISIT,
          products: VISIT.products.map((p) =>
            p.id === "p1" ? { ...p, name: "ข้าวจานใหม่" } : p,
          ),
        },
        cart,
      ),
    ).toBe(true);
    expect(
      cartNeedsReview(
        VISIT,
        {
          ...VISIT,
          categories: [{ ...VISIT.categories[0]!, name: "เมนูหลัก" }],
        },
        cart,
      ),
    ).toBe(true);
    expect(
      cartNeedsReview(
        VISIT,
        {
          ...VISIT,
          modifierOptions: VISIT.modifierOptions.map((o) =>
            o.id === "o1" ? { ...o, name: "ไข่พิเศษ" } : o,
          ),
        },
        cart,
      ),
    ).toBe(true);
  });

  it("does not accept offsetting price deltas or per-line swaps masked by a matching grand total", () => {
    const selected = [
      { productId: "p1", optionIds: ["o1", "o2"], quantity: 1 },
    ];
    const moved = {
      ...VISIT,
      modifierOptions: VISIT.modifierOptions.map((o) =>
        o.id === "o1"
          ? { ...o, priceDeltaSatang: 2000 }
          : o.id === "o2"
            ? { ...o, priceDeltaSatang: -1500 }
            : o,
      ),
    };
    expect(estimateSatang(VISIT, selected)).toBe(
      estimateSatang(moved, selected),
    );
    expect(cartNeedsReview(VISIT, moved, selected)).toBe(true);

    const twoLines = [
      { productId: "p1", optionIds: ["o1"], quantity: 1 },
      { productId: "p2", optionIds: [], quantity: 1 },
    ];
    const changedPrices = {
      ...VISIT,
      products: VISIT.products.map((p) =>
        p.id === "p1"
          ? { ...p, priceSatang: p.priceSatang + 500 }
          : { ...p, priceSatang: p.priceSatang - 500 },
      ),
    };
    expect(estimateSatang(VISIT, twoLines)).toBe(
      estimateSatang(changedPrices, twoLines),
    );
    expect(cartNeedsReview(VISIT, changedPrices, twoLines)).toBe(true);
  });

  it("rejects new required modifiers, removed choices, visit changes and missing products", () => {
    const cart = [{ productId: "p1", optionIds: ["o1"], quantity: 1 }];
    const required = {
      ...VISIT,
      modifierGroups: [
        ...VISIT.modifierGroups,
        {
          id: "g2",
          productId: "p1",
          slug: "spice",
          name: "ระดับเผ็ด",
          minSelect: 1,
          maxSelect: 1,
        },
      ],
    };
    expect(cartNeedsReview(VISIT, required, cart)).toBe(true);
    expect(
      cartNeedsReview(
        VISIT,
        {
          ...VISIT,
          modifierOptions: VISIT.modifierOptions.filter((o) => o.id !== "o1"),
        },
        cart,
      ),
    ).toBe(true);
    expect(
      cartNeedsReview(VISIT, { ...VISIT, tableId: "different" }, cart),
    ).toBe(true);
    expect(
      cartNeedsReview(
        VISIT,
        {
          ...VISIT,
          products: VISIT.products.filter((p) => p.id !== "p1"),
        },
        cart,
      ),
    ).toBe(true);
  });

  it("reviews only selected cart products while preserving unrelated paged items", () => {
    const lines = [{ productId: "p1", optionIds: ["o1"], quantity: 1 }];
    const scoped = {
      ...VISIT,
      products: [{ ...VISIT.products[0]!, name: "ข้าวใหม่" }],
      modifierGroups: [VISIT.modifierGroups[0]!],
      modifierOptions: [{ ...VISIT.modifierOptions[0]!, name: "ไข่เพิ่ม" }],
    };
    expect(cartNeedsReview(VISIT, scoped, lines)).toBe(true);
    const merged = mergeCartReview(VISIT, scoped, lines);
    expect(merged.products.find((p) => p.id === "p2")?.name).toBe("น้ำ");
    expect(merged.products.find((p) => p.id === "p1")?.name).toBe("ข้าวใหม่");
    expect(merged.modifierOptions.map((o) => o.id)).toEqual(["o1"]);
    expect(merged.modifierOptions[0]?.name).toBe("ไข่เพิ่ม");
    expect(cartNeedsReview(merged, scoped, lines)).toBe(false);
  });

  it("rejects a withdrawn cart item without losing other loaded products", () => {
    const lines = [{ productId: "p1", optionIds: ["o1"], quantity: 1 }];
    const scoped = {
      ...VISIT,
      products: [],
      modifierGroups: [],
      modifierOptions: [],
      categories: [],
    };
    expect(cartNeedsReview(VISIT, scoped, lines)).toBe(true);
    const merged = mergeCartReview(VISIT, scoped, lines);
    expect(merged.products.map((p) => p.id)).toEqual(["p2"]);
    expect(selectedOptionError(merged, "p1", ["o1"])).not.toBe(null);
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
