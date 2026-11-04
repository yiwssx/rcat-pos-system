import { describe, expect, it } from "vitest";
import {
  validInventoryId,
  validQuantity,
  validRecipeQuantity,
  validateItem,
  validateMovement,
} from "./inventory.core";

const ITEM = "10000000-0000-4000-8000-000000000001";
const KEY = "33333333-3333-4333-8333-333333333333";

describe("G3 stock amount and replay input safety", () => {
  it("accepts only bounded fixed-point stock quantities without IEEE floats", () => {
    for (const value of ["0", "1", "0.001", "100.125", "1000000000.000"]) {
      expect(validQuantity(value, 1000000000n, true, true)).toBe(true);
    }
    for (const value of [
      100,
      1.55,
      "NaN",
      "Infinity",
      "1e4",
      "0.0001",
      "01",
      "1.",
      ".5",
      " 1",
      "1 ",
      "0x01",
      "1,000",
      "",
      "1000000001",
    ]) {
      expect(validQuantity(value, 1000000000n, true, true)).toBe(false);
    }
    expect(validQuantity("-25.125", 1000000000n, true, false)).toBe(true);
    expect(validQuantity("-25.125", 1000000000n, false, false)).toBe(false);
    expect(validQuantity("-0", 1000000000n, true, false)).toBe(false);
  });

  it("validates new ingredient unit, bounds and reorder threshold", () => {
    expect(
      validateItem({ name: " ข้าวสาร ", unit: "g", reorderAt: "1000.000" }),
    ).toEqual({ name: "ข้าวสาร", unit: "g", reorderAt: "1000.000" });
    expect(validateItem({ name: "น้ำ", unit: "ml", reorderAt: "0" })).not.toBe(
      null,
    );
    expect(
      validateItem({ name: "จาน", unit: "unit", reorderAt: "0" }),
    ).not.toBe(null);
    expect(validateItem({ name: "x", unit: "kg", reorderAt: "1" })).toBe(null);
    expect(validateItem({ name: "x", unit: "g", reorderAt: "-1" })).toBe(null);
    expect(
      validateItem({ name: "x".repeat(121), unit: "g", reorderAt: "1" }),
    ).toBe(null);
  });

  it("refuses replay without stable UUID key, invalid reasons and negative receipts", () => {
    const body = {
      itemId: ITEM,
      idempotencyKey: KEY,
      kind: "receipt",
      delta: "125.250",
      reason: "รับจากผู้ขาย",
    };
    expect(validateMovement(body)).toEqual(body);
    expect(validateMovement({ ...body, delta: "-1" })).toBe(null);
    expect(
      validateMovement({ ...body, kind: "adjustment", delta: "-1.500" }),
    ).not.toBe(null);
    expect(validateMovement({ ...body, delta: "0" })).toBe(null);
    expect(validateMovement({ ...body, reason: "x" })).toBe(null);
    expect(validateMovement({ ...body, idempotencyKey: "not-a-uuid" })).toBe(
      null,
    );
    expect(validateMovement({ ...body, itemId: "../tenant" })).toBe(null);
    expect(validInventoryId(ITEM)).toBe(true);
    expect(validInventoryId("not-an-id")).toBe(false);
  });

  it("zero recipe quantity deletes metadata without decrementing stock", () => {
    expect(validRecipeQuantity("0")).toBe(true);
    expect(validRecipeQuantity("0.001")).toBe(true);
    expect(validRecipeQuantity("1000000000")).toBe(true);
    expect(validRecipeQuantity("-1")).toBe(false);
    expect(validRecipeQuantity("1000000001")).toBe(false);
  });
});
