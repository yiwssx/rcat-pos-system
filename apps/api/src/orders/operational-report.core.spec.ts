import { describe, expect, it } from "vitest";
import {
  csvField,
  operationalReportCsv,
  OperationalDailyReport,
  validBusinessDay,
} from "./operational-report.core";

const report: OperationalDailyReport = {
  day: "2026-11-04",
  timezone: "Asia/Bangkok",
  snapshotType: "ordered_not_paid",
  paymentStatus: "not_implemented",
  orderCount: 2,
  statusCounts: {
    submitted: 0,
    accepted: 1,
    preparing: 0,
    served: 0,
    cancelled: 1,
  },
  orderedAmountSatang: "30700",
  activeOrderedAmountSatang: "20800",
  cancelledOrderedAmountSatang: "9900",
  servedOrderedAmountSatang: "0",
  avgSecondsToAccept: 12,
  avgSecondsToServe: null,
  topProducts: [
    {
      productId: "product-id",
      productName: '=HYPERLINK("https://attacker.invalid")',
      unitsOrdered: "2",
      orderedAmountSatang: "20800",
    },
  ],
};

describe("operational reporting security and business-day semantics", () => {
  it("rejects invalid calendar dates rather than normalizing them", () => {
    expect(validBusinessDay("2028-02-29")).toBe(true);
    expect(validBusinessDay("2026-02-29")).toBe(false);
    expect(validBusinessDay("2026-11-31")).toBe(false);
    expect(validBusinessDay("2026-13-01")).toBe(false);
    expect(validBusinessDay("2026-11-4")).toBe(false);
    expect(validBusinessDay("2101-01-01")).toBe(false);
    expect(validBusinessDay(["2026-11-04"])).toBe(false);
  });

  it("prevents formula injection and escapes commas, quotes and newlines", () => {
    expect(csvField("=1+2")).toBe('"\'=1+2"');
    expect(csvField("  +SUM(1,2)")).toBe('"\'  +SUM(1,2)"');
    expect(csvField("@macro")).toBe('"\'@macro"');
    expect(csvField("-1")).toBe('"\'-1"');
    expect(csvField('hello,"world"')).toBe('"hello,""world"""');
    expect(csvField("a\nb")).toBe('"a b"');
  });

  it("exports only order value and explicitly rejects payment/revenue implication", () => {
    const csv = operationalReportCsv(report);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("ORDERED VALUE ONLY — NOT REVENUE");
    expect(csv).toContain("not_implemented");
    expect(csv).toContain("2026-11-04");
    expect(csv).toContain("Asia/Bangkok");
    expect(csv).toContain("30700");
    expect(csv).toContain("20800");
    expect(csv).toContain("9900");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain("provider_verified");
    expect(csv).not.toContain("PromptPay");
  });
});
