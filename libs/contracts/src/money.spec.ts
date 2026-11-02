import { describe, expect, it } from "vitest";
import { parseThbToSatang } from "./money";

describe("THB satang conversion", () => {
  it.each([
    ["0", 0],
    ["1", 100],
    ["1.2", 120],
    ["1.20", 120],
    ["150.25", 15025],
    ["99999.99", 9999999],
  ])("converts %s to %i satang without floating point", (input, expected) => {
    expect(parseThbToSatang(input)).toBe(expected);
  });

  it.each([
    "-1",
    "1.234",
    "1e3",
    " 1",
    "1.",
    "",
    "NaN",
    "01",
    "10000000000000000000000",
  ])("rejects unsafe or invalid input %s", (input) => {
    expect(() => parseThbToSatang(input)).toThrow();
  });
});
