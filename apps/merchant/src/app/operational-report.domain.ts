export interface OperationalDailyReport {
  day: string;
  timezone: "Asia/Bangkok";
  snapshotType: "ordered_not_paid";
  paymentStatus: "not_implemented";
  orderCount: number;
  statusCounts: Record<
    "submitted" | "accepted" | "preparing" | "served" | "cancelled",
    number
  >;
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

// Avoid using local host timezone or UTC for the Thai business-day cut-off.
export function todayBangkok(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const field = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${field("year")}-${field("month")}-${field("day")}`;
}

export function formatReportSatang(satang: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(satang)) return "—";
  const raw = BigInt(satang);
  const integer = raw / 100n;
  const cents = String(raw % 100n).padStart(2, "0");
  return `${new Intl.NumberFormat("th-TH").format(integer)}.${cents}`;
}

export function formatReportSeconds(value: number | null): string {
  if (value === null || !Number.isSafeInteger(value) || value < 0)
    return "ไม่มีข้อมูล";
  if (value < 60) return `${value} วินาที`;
  return `${Math.floor(value / 60)} นาที ${value % 60} วินาที`;
}

export function operationalReportPath(
  tenantId: string,
  storeId: string,
): string {
  return `/api/tenants/${encodeURIComponent(tenantId)}/stores/${encodeURIComponent(storeId)}/reports/operations`;
}
