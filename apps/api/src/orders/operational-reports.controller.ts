import { Controller, Get, Header, Param, Query, Req, Res } from "@nestjs/common";
import { ServerResponse } from "node:http";
import { ApiRequest } from "../auth/request-security";
import { operationalReportCsv } from "./operational-report.core";
import { OperationalReportsService } from "./operational-reports.service";

@Controller("tenants/:tenantId/stores/:storeId/reports")
export class OperationalReportsController {
  constructor(private readonly reports: OperationalReportsService) {}

  @Get("operations")
  @Header("Cache-Control", "no-store")
  daily(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Query("day") day: unknown,
  ) {
    return this.reports.daily(req, tenantId, storeId, day);
  }

  @Get("operations.csv")
  @Header("Cache-Control", "no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async csv(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Query("day") day: unknown,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<string> {
    const data = await this.reports.daily(req, tenantId, storeId, day);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="rcat-orders-${data.day}.csv"`,
    );
    return operationalReportCsv(data);
  }
}
