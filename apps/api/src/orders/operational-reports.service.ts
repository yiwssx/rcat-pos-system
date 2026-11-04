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
import {
  OperationalDailyReport,
  validBusinessDay,
} from "./operational-report.core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
