import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "./merchant-catalog.api";
import {
  CATALOG_PAGE_SIZE,
  catalogPageCount,
  filterCatalogProducts,
  paginateCatalogProducts,
} from "./catalog-list";

function product(
  id: number,
  categoryId = "food",
  archivedAt: string | null = null,
): CatalogProduct {
  return {
    id: String(id),
    name: id === 1 ? "ข้าวผัดไก่" : "เมนู " + id,
    categoryId,
    priceSatang: 4500,
    available: archivedAt === null,
    revision: 1,
    archivedAt,
    hasImage: false,
  };
}

describe("merchant catalog filtering and pagination", () => {
  it("hides archived products by default, but includes them on request", () => {
    const products = [product(1), product(2, "drinks", "2026-11-07T00:00:00Z")];
    expect(
      filterCatalogProducts(products, {
        search: "",
        categoryId: "",
        includeArchived: false,
      }).map((item) => item.id),
    ).toEqual(["1"]);
    expect(
      filterCatalogProducts(products, {
        search: "",
        categoryId: "",
        includeArchived: true,
      }),
    ).toHaveLength(2);
  });

  it("combines category filtering and trimmed Thai-name search", () => {
    const products = [product(1), product(2, "drinks"), product(3)];
    expect(
      filterCatalogProducts(products, {
        search: "  ข้าวผัด  ",
        categoryId: "food",
        includeArchived: false,
      }).map((item) => item.id),
    ).toEqual(["1"]);
    expect(
      filterCatalogProducts(products, {
        search: "ข้าวผัด",
        categoryId: "drinks",
        includeArchived: false,
      }),
    ).toHaveLength(0);
  });

  it("paginates 55 products into bounded non-overlapping pages", () => {
    const items = Array.from({ length: 55 }, (_, index) => product(index + 1));
    expect(catalogPageCount(items.length)).toBe(3);
    const pages = [1, 2, 3].map((page) =>
      paginateCatalogProducts(items, page),
    );
    expect(pages.map((page) => page.length)).toEqual([20, 20, 15]);
    expect(new Set(pages.flat().map((item) => item.id)).size).toBe(55);
    expect(paginateCatalogProducts(items, 99)).toEqual(pages[2]);
    expect(paginateCatalogProducts(items, 0)).toEqual(pages[0]);
    expect(paginateCatalogProducts(items, Number.NaN)).toEqual(pages[0]);
  });

  it("has one empty page and rejects invalid page sizes", () => {
    expect(catalogPageCount(0)).toBe(1);
    expect(paginateCatalogProducts([], 1)).toEqual([]);
    expect(CATALOG_PAGE_SIZE).toBe(20);
    expect(() => catalogPageCount(3, 0)).toThrow(RangeError);
    expect(() => catalogPageCount(-1)).toThrow(RangeError);
  });
});
