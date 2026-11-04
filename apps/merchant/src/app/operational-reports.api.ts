import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  OperationalDailyReport,
  operationalReportPath,
} from "./operational-report.domain";

@Injectable({ providedIn: "root" })
export class OperationalReportsApi {
  private readonly http = inject(HttpClient);

  daily(
    tenantId: string,
    storeId: string,
    day: string,
  ): Promise<OperationalDailyReport> {
    return firstValueFrom(
      this.http.get<OperationalDailyReport>(
        operationalReportPath(tenantId, storeId),
        { params: { day }, withCredentials: true },
      ),
    );
  }

  csvUrl(tenantId: string, storeId: string, day: string): string {
    return (
      operationalReportPath(tenantId, storeId) +
      ".csv?day=" +
      encodeURIComponent(day)
    );
  }
}
