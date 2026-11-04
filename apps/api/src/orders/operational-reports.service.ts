import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { ApiRequest } from "../auth/request-security";
import { AuthService } from "../auth/auth.service";
import { DatabaseAccess } from "../database/db-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

@Injectable()
export class OperationalReportsService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async daily(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    day: unknown,
  ): Promise<OperationalDailyReport> {
    if (!UUID.test(tenantId) || !UUID.test(storeId)) {
      throw new NotFoundException("Report unavailable");
    }
    if (!validBusinessDay(day)) {
      throw new BadRequestException("Invalid business day");
    }
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: OperationalDailyReport }>(
          "SELECT rcat_private.merchant_daily_operational_report($1,$2,$3,$4::date) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId, day],
        ),
      );
      const data = result.rows[0]?.data;
      if (!data || data.snapshotType !== "ordered_not_paid") {
        throw new ServiceUnavailableException("Report unavailable");
      }
      return data;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code: unknown }).code
          : null;
      if (code === "42501" || code === "28000") {
        throw new NotFoundException("Report unavailable");
      }
      if (code === "22023" || code === "22P02" || code === "22008") {
        throw new BadRequestException("Invalid report date");
      }
      throw error;
    }
  }
}
