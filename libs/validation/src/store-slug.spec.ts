import { describe, expect, it } from "vitest";
import { isValidStoreSlug } from "./store-slug";

describe("store URL slug validation", () => {
  it.each(["rcat-cafe", "restaurant123", "a-b", "abc"])(
    "accepts %s",
    (input) => {
      expect(isValidStoreSlug(input)).toBe(true);
    },
  );

  it("rejects malformed slugs and non-strings", () => {
    for (const value of ["", "a", "a-", "-abc", "UPPER", "two spaces", "a--b"]) {
      expect(isValidStoreSlug(value)).toBe(false);
    }
    expect(isValidStoreSlug("../admin")).toBe(false);
    expect(isValidStoreSlug(null)).toBe(false);
    expect(isValidStoreSlug(123)).toBe(false);
  });
});
