import { describe, expect, it } from "vitest";
import { validateRecoveryIssue } from "./payment-recovery.core";

describe("merchant payment recovery input", () => {
  it("accepts explicitly reviewed orders at their exact satang amount", () => {
    expect(
      validateRecoveryIssue({
        expectedState: "not_requested",
        expectedAmountSatang: 2500,
        reviewed: true,
      }),
    ).toEqual({ expectedState: "not_requested", expectedAmountSatang: 2500 });
  });
  it("rejects confirmed, unreviewed, zero or extraneous mutations", () => {
    for (const raw of [
      {
        expectedState: "manual_confirmed",
        expectedAmountSatang: 2500,
        reviewed: true,
      },
      {
        expectedState: "not_requested",
        expectedAmountSatang: 2500,
        reviewed: false,
      },
      {
        expectedState: "awaiting_payment",
        expectedAmountSatang: 0,
        reviewed: true,
      },
      {
        expectedState: "awaiting_payment",
        expectedAmountSatang: 2500,
        reviewed: true,
        paid: true,
      },
    ])
      expect(() => validateRecoveryIssue(raw)).toThrow();
  });
});
