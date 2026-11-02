import { describe, expect, it } from "vitest";
import { isValidStoreSlug } from "./store-slug";

describe("store URL slug validation", () => {
  it.each(["rcat-cafe", "restaurant123", "a-b", "abc"])(
    "accepts %s",
    (input) => {
      expect(isValidStoreSlug(input)).toBe(true);
    },
  );

  it.each(["", "a", "a-", "-abc", "UPPER", "two spaces", "a--b", "../admin", null, 123])(
    "rejects invalid input %s",
    (input) => {
      expect(isValidStoreSlug(input)).toBe(false);
    },
  );
});
