import { DOCUMENT } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

export type ServiceMode = "table" | "quick" | "hybrid";

export interface StoreServiceMode {
  serviceMode: ServiceMode;
  revision: number;
}
export interface StoreQr {
  publicId: string | null;
  printedUrl: string | null;
  orderingEnabled: boolean;
  serviceMode: ServiceMode;
}
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
  return (
    "/api/tenants/" +
    encodeURIComponent(tenant) +
    "/stores/" +
    encodeURIComponent(store)
  );
}

@Injectable({ providedIn: "root" })
export class MerchantTablesApi {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private headers(): { "X-CSRF-Token": string } {
    const match = this.document.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((item) => item.startsWith("__Host-rcat_csrf="));
    const csrf = match[0]?.slice("__Host-rcat_csrf=".length);
    if (match.length !== 1 || !csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf))
      throw new Error("กรุณาเข้าสู่ระบบอีกครั้ง");
    return { "X-CSRF-Token": csrf };
  }

  list(
    tenant: string,
    store: string,
  ): Promise<{
    tables: PrintableTable[];
    orderingEnabled: boolean;
  }> {
    return firstValueFrom(
      this.http.get<{ tables: PrintableTable[]; orderingEnabled: boolean }>(
        scope(tenant, store) + "/tables",
        {
          withCredentials: true,
        },
      ),
    );
  }

  setOrderingEnabled(
    tenant: string,
    store: string,
    enabled: boolean,
  ): Promise<{ orderingEnabled: boolean }> {
    return firstValueFrom(
      this.http.post<{ orderingEnabled: boolean }>(
        scope(tenant, store) + "/ordering-state",
        { enabled },
        { withCredentials: true, headers: this.headers() },
      ),
    );
  }

  add(
    tenant: string,
    store: string,
    label: string,
  ): Promise<{ tableId: string }> {
    return firstValueFrom(
      this.http.post<{ tableId: string }>(
        scope(tenant, store) + "/tables",
        { label },
        { withCredentials: true, headers: this.headers() },
      ),
    );
  }

  issueCode(
    tenant: string,
    store: string,
    table: string,
  ): Promise<IssuedTableCode> {
    return firstValueFrom(
      this.http.post<IssuedTableCode>(
        scope(tenant, store) +
          "/tables/" +
          encodeURIComponent(table) +
          "/issue-code",
        {},
        { withCredentials: true, headers: this.headers() },
      ),
    );
  }

  mode(tenant: string, store: string): Promise<StoreServiceMode> {
    return firstValueFrom(
      this.http.get<StoreServiceMode>(scope(tenant, store) + "/service-mode", {
        withCredentials: true,
      }),
    );
  }

  changeMode(
    tenant: string,
    store: string,
    serviceMode: ServiceMode,
    expectedRevision: number,
  ): Promise<StoreServiceMode> {
    return firstValueFrom(
      this.http.post<StoreServiceMode>(
        scope(tenant, store) + "/service-mode",
        { serviceMode, expectedRevision },
        { withCredentials: true, headers: this.headers() },
      ),
    );
  }

  storeQr(tenant: string, store: string): Promise<StoreQr> {
    return firstValueFrom(
      this.http.get<StoreQr>(scope(tenant, store) + "/store-qr", {
        withCredentials: true,
      }),
    );
  }

  rotateStoreQr(
    tenant: string,
    store: string,
  ): Promise<{ publicId: string; printedUrl: string }> {
    return firstValueFrom(
      this.http.post<{ publicId: string; printedUrl: string }>(
        scope(tenant, store) + "/store-qr/rotate",
        {},
        { withCredentials: true, headers: this.headers() },
      ),
    );
  }

  storeQrUrl(tenant: string, store: string, publicId: string): string {
    return (
      scope(tenant, store) +
      "/store-qr/print-qr.svg?v=" +
      encodeURIComponent(publicId)
    );
  }

  qrUrl(tenant: string, store: string, table: string): string {
    return (
      scope(tenant, store) +
      "/tables/" +
      encodeURIComponent(table) +
      "/print-qr.svg"
    );
  }
}
