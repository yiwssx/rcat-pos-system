// Pure, import-safe report domain and CSV protection used by Vitest and NestJS.
const DAY = /^(20[2-9][0-9]|2100)-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$/;

export interface OperationalDailyReport {
  day: string;
  timezone: "Asia/Bangkok";
  snapshotType: "ordered_not_paid";
  paymentStatus: "not_implemented";
  orderCount: number;
  statusCounts: Record<"submitted" | "accepted" | "preparing" | "served" | "cancelled", number>;
  orderedAmountSatang: string;
  activeOrderedAmountSatang: string;
  cancelledOrderedAmountSatang: string;
  servedOrderedAmountSatang: string;
  avgSecondsToAccept: number | null;
  avgSecondsToServe: number | null;
  topProducts: {
    productId: string;
    productName: string;
    unitsOrdered: string;
    orderedAmountSatang: string;
  }[];
}

export function validBusinessDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
}

// Excel opens CSV cells beginning =,+,-,@ as formulas. Every CSV field is
// quoted and formula-looking data receives a literal leading apostrophe.
export function csvField(input: string | number): string {
  const data = String(input).replace(/\r|\n/g, " ");
  const escaped = /^[\s]*[=+\-@]/.test(data) || /^[\t\r]/.test(data)
    ? "'" + data
    : data;
  return '"' + escaped.replace(/"/g, '""') + '"';
}
export function operationalReportCsv(data: OperationalDailyReport): string {
  const row = (...values: (string | number)[]) =>
    values.map(csvField).join(",") + "\r\n";
  let csv = "\ufeff";
  csv += row("RCAT POS Operational Report", "ORDERED VALUE ONLY — NOT REVENUE");
  csv += row("Business day", data.day);
  csv += row("Timezone", data.timezone);
  csv += row("Payment status", data.paymentStatus);
  csv += row("Orders", data.orderCount);
  csv += row("All order value (satang; not paid)", data.orderedAmountSatang);
  csv += row("Non-cancelled order value (satang; not paid)",
    data.activeOrderedAmountSatang);
  csv += row("Cancelled order value (satang; not paid)",
    data.cancelledOrderedAmountSatang);
  csv += row("Served order value (satang; not paid)",
    data.servedOrderedAmountSatang);
  csv += row("Average seconds to accept", data.avgSecondsToAccept ?? "N/A");
  csv += row("Average seconds to serve", data.avgSecondsToServe ?? "N/A");
  csv += row();
  csv += row("Product", "Units ordered (non-cancelled)", "Order value satang (not paid)");
  for (const item of data.topProducts) {
    csv += row(item.productName, item.unitsOrdered, item.orderedAmountSatang);
  }
  return csv;
}

