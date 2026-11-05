import { DOCUMENT } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

export interface PrintableTable {
  tableId: string;
  label: string;
  active: boolean;
  codeExpiresAt: string | null;
  printedUrl: string;
}

export interface IssuedTableCode {
  visitId: string;
  expiresAt: string;
  code: string;
  printedUrl: string;
}

function scope(tenant: string, store: string): string {
  return "/api/tenants/" + encodeURIComponent(tenant) + "/stores/" + encodeURIComponent(store);
}

@Injectable({ providedIn: "root" })
export class MerchantTablesApi {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private headers(): { "X-CSRF-Token": string } {
    const match = this.document.cookie.split(";").map((part) => part.trim())
      .filter((item) => item.startsWith("__Host-rcat_csrf="));
    const csrf = match[0]?.slice("__Host-rcat_csrf=".length);
    if (match.length !== 1 || !csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf))
      throw new Error("กรุณาเข้าสู่ระบบอีกครั้ง");
    return { "X-CSRF-Token": csrf };
  }

  list(tenant: string, store: string): Promise<{ tables: PrintableTable[] }> {
    return firstValueFrom(
      this.http.get<{ tables: PrintableTable[] }>(scope(tenant, store) + "/tables", {
        withCredentials: true,
      }),
    );
  }

  add(tenant: string, store: string, label: string): Promise<{ tableId: string }> {
    return firstValueFrom(
      this.http.post<{ tableId: string }>(
        scope(tenant, store) + "/tables", { label },
        { withCredentials: true, headers: this.headers() },
      ),
    );
  }

  issueCode(tenant: string, store: string, table: string): Promise<IssuedTableCode> {
    return firstValueFrom(
      this.http.post<IssuedTableCode>(
        scope(tenant, store) + "/tables/" + encodeURIComponent(table) + "/issue-code",
        {}, { withCredentials: true, headers: this.headers() },
      ),
    );
  }

  qrUrl(tenant: string, store: string, table: string): string {
    return scope(tenant, store) + "/tables/" + encodeURIComponent(table) + "/print-qr.svg";
  }
}
