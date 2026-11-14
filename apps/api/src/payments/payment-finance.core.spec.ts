import { describe, expect, it } from "vitest";
import {
  parseExceptionResolution,
  parseFinanceDays,
  parsePaymentException,
  parseRefundDecision,
  parseRefundRequest,
} from "./payment-finance.core";

const orderId = "11111111-1111-4111-8111-111111111111";

describe("manual finance requests — exact satang, no bank-side effects", () => {
  it("accepts only a bounded report window", () => {
    expect(parseFinanceDays(undefined)).toBe(30);
    expect(parseFinanceDays("90")).toBe(90);
    for (const bad of ["0", "91", "030", "999", "3.5", 1, {}, null]) {
      expect(() => parseFinanceDays(bad)).toThrow();
    }
  });

  it("accepts an exact refund with required Order context and reason", () => {
    expect(
      parseRefundRequest({
        orderId,
        amountSatang: 18900,
        reason: " Partial customer refund ",
      }),
    ).toEqual({
      orderId,
      amountSatang: 18900,
      reason: "Partial customer refund",
    });
    for (const bad of [0, -1, 100000001, 1.5, "18900", Number.NaN]) {
      expect(() =>
        parseRefundRequest({
          orderId,
          amountSatang: bad,
          reason: "Item refund",
        }),
      ).toThrow();
    }
    expect(() =>
      parseRefundRequest({
        orderId,
        amountSatang: 100,
        reason: "Item refund",
        confirmed: true,
      }),
    ).toThrow();
  });

  it("never records a manual refund without the external bank checklist", () => {
    expect(
      parseRefundDecision({
        action: "void",
        expectedRevision: 1,
      }),
    ).toMatchObject({ action: "void", bankChecked: false });
    expect(
      parseRefundDecision({
        action: "record",
        expectedRevision: 1,
        bankReference: "abc-12345",
        actualAmountSatang: 18900,
        bankChecked: true,
      }),
    ).toMatchObject({
      action: "record",
      bankReference: "ABC-12345",
      actualAmountSatang: 18900,
      bankChecked: true,
    });
    expect(() =>
      parseRefundDecision({
        action: "record",
        expectedRevision: 1,
        bankReference: "abc-12345",
        actualAmountSatang: 18900,
        bankChecked: false,
      }),
    ).toThrow();
    expect(() =>
      parseRefundDecision({
        action: "void",
        expectedRevision: 1,
        bankReference: "fake",
      }),
    ).toThrow();
  });

  it("requires structured discrepancy categories and scoped optional order", () => {
    const data = parsePaymentException({
      orderId: null,
      kind: "unmatched_transfer",
      amountSatang: null,
      note: "  Unmatched bank deposit ",
    });
    expect(data.orderId).toBe(null);
    expect(data.amountSatang).toBe(null);
    expect(data.note).toBe("Unmatched bank deposit");
    expect(() =>
      parsePaymentException({
        orderId: "foreign",
        kind: "other",
        amountSatang: 100,
        note: "Discrepancy",
      }),
    ).toThrow();
    expect(() =>
      parsePaymentException({
        orderId: null,
        kind: "bank_verified",
        amountSatang: 100,
        note: "Discrepancy",
      }),
    ).toThrow();
    expect(
      parseExceptionResolution({
        expectedRevision: 2,
        resolution: "  Checked outside payment ledger ",
      }),
    ).toEqual({
      expectedRevision: 2,
      resolution: "Checked outside payment ledger",
    });
    expect(() =>
      parseExceptionResolution({
        expectedRevision: 0,
        resolution: "Checked",
      }),
    ).toThrow();
  });
});
