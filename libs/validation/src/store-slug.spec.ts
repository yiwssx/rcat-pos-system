import { describe, expect, it } from "vitest";
import { isValidStoreSlug } from "./store-slug";

describe("store URL slug validation", () => {
  it("accepts valid URL slugs", () => {
    expect(isValidStoreSlug("rcat-cafe")).toBe(true);
    expect(isValidStoreSlug("restaurant123")).toBe(true);
    expect(isValidStoreSlug("a-b")).toBe(true);
    expect(isValidStoreSlug("abc")).toBe(true);
  });

  it("rejects malformed slugs and non-strings", () => {
    expect(isValidStoreSlug("")).toBe(false);
    expect(isValidStoreSlug("a")).toBe(false);
    expect(isValidStoreSlug("a-")).toBe(false);
    expect(isValidStoreSlug("-abc")).toBe(false);
    expect(isValidStoreSlug("UPPER")).toBe(false);
    expect(isValidStoreSlug("two spaces")).toBe(false);
    expect(isValidStoreSlug("a--b")).toBe(false);
    expect(isValidStoreSlug("../admin")).toBe(false);
    expect(isValidStoreSlug(null)).toBe(false);
    expect(isValidStoreSlug(123)).toBe(false);
  });
});
