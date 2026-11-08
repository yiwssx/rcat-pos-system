import type { CatalogProduct } from "./merchant-catalog.api";

export const CATALOG_PAGE_SIZE = 20;

export interface CatalogListFilters {
  search: string;
  categoryId: string;
  includeArchived: boolean;
}

/**
 * Filters only the merchant's already-authorized catalog snapshot.
 * The API remains authoritative for product visibility and writes.
 */
export function filterCatalogProducts(
  products: readonly CatalogProduct[],
  filters: CatalogListFilters,
): CatalogProduct[] {
  const term = filters.search.trim().toLocaleLowerCase("th-TH");
  return products.filter(
    (product) =>
      (filters.includeArchived || !product.archivedAt) &&
      (!filters.categoryId || product.categoryId === filters.categoryId) &&
      (!term || product.name.toLocaleLowerCase("th-TH").includes(term)),
  );
}

export function catalogPageCount(
  itemCount: number,
  pageSize: number = CATALOG_PAGE_SIZE,
): number {
  if (!Number.isSafeInteger(itemCount) || itemCount < 0) {
    throw new RangeError("Invalid catalog item count");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError("Invalid catalog page size");
  }
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

export function paginateCatalogProducts<T>(
  products: readonly T[],
  page: number,
  pageSize: number = CATALOG_PAGE_SIZE,
): T[] {
  const pageCount = catalogPageCount(products.length, pageSize);
  const safePage = Number.isSafeInteger(page)
    ? Math.min(pageCount, Math.max(1, page))
    : 1;
  const start = (safePage - 1) * pageSize;
  return products.slice(start, start + pageSize);
}

/** Signed modifier deltas are UI-only input; PostgreSQL still recalculates Order totals. */
export function parseDeltaBaht(value: string): number | null {
  const match = /^(-?)(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const amount = Number(match[2]) * 100 +
    Number((match[3] ?? "").padEnd(2, "0"));
  return amount <= 100000000 ? (match[1] ? -amount : amount) : null;
}

