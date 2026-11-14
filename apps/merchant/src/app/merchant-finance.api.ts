import { DOCUMENT } from "@angular/common";
import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

export interface FinanceOrder {
  orderId: string;
  displayNumber: string;
  amountSatang: number;
  status: string;
  paymentState: string;
  createdAt: string;
}
export interface FinanceRefund {
  refundId: string;
  orderId: string;
  displayNumber: string;
  amountSatang: number;
  reason: string;
  state: "pending" | "manually_recorded" | "voided";
  revision: number;
  requestedAt: string;
  decidedAt: string | null;
}
export interface FinanceException {
  exceptionId: string;
  orderId: string | null;
  displayNumber: string | null;
  kind: string;
  amountSatang: number | null;
  note: string;
  state: "open" | "resolved";
  revision: number;
  openedAt: string;
  resolution: string | null;
}
export interface FinanceReport {
  windowDays: number;
  generatedAt: string;
  verification: "merchant_manual_only";
  summary: {
    orderCount: number;
    orderTotalSatang: string;
    outstandingOrderCount: number;
    outstandingSatang: string;
    submittedSlipCount: number;
    cancelledConfirmedCount: number;
    manualReceiptSatang: string;
    manualRefundRecordedSatang: string;
    manualRefundPendingSatang: string;
    openExceptionCount: number;
  };
  outstandingOrders: FinanceOrder[];
  confirmedOrders: FinanceOrder[];
  refunds: FinanceRefund[];
  exceptions: FinanceException[];
}

@Injectable({ providedIn: "root" })
export class MerchantFinanceApi {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private path(tenant: string, store: string): string {
    return (
      "/api/tenants/" +
      encodeURIComponent(tenant) +
      "/stores/" +
      encodeURIComponent(store) +
      "/payments/finance"
    );
  }

  private csrf(): string {
    const cookies = this.document.cookie.split(";").map((s) => s.trim());
    const matches = cookies.filter((s) => s.startsWith("__Host-rcat_csrf="));
    const value = matches[0]?.slice("__Host-rcat_csrf=".length);
    if (matches.length !== 1 || !value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
      throw new Error("กรุณายืนยันตัวตนใหม่เพื่อทำรายการ");
    }
    return value;
  }

  private post<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(
      this.http.post<T>(url, body, {
        headers: { "X-CSRF-Token": this.csrf() },
        withCredentials: true,
      }),
    );
  }

  report(tenant: string, store: string, days = 30): Promise<FinanceReport> {
    return firstValueFrom(
      this.http.get<FinanceReport>(this.path(tenant, store) + "/report", {
        withCredentials: true,
        params: new HttpParams().set("days", String(days)),
      }),
    );
  }

  requestRefund(
    tenant: string,
    store: string,
    orderId: string,
    amountSatang: number,
    reason: string,
  ) {
    return this.post<{ refundId: string }>(
      this.path(tenant, store) + "/refunds",
      { orderId, amountSatang, reason },
    );
  }

  refundDecision(
    tenant: string,
    store: string,
    refundId: string,
    payload:
      | { action: "void"; expectedRevision: number }
      | {
          action: "record";
          expectedRevision: number;
          bankReference: string;
          actualAmountSatang: number;
          bankChecked: true;
        },
  ) {
    return this.post<{ refundId: string; state: string }>(
      this.path(tenant, store) +
        "/refunds/" +
        encodeURIComponent(refundId) +
        "/decision",
      payload,
    );
  }

  openException(
    tenant: string,
    store: string,
    payload: {
      orderId: string | null;
      kind: string;
      amountSatang: number | null;
      note: string;
    },
  ) {
    return this.post<{ exceptionId: string }>(
      this.path(tenant, store) + "/exceptions",
      payload,
    );
  }

  resolveException(
    tenant: string,
    store: string,
    exceptionId: string,
    expectedRevision: number,
    resolution: string,
  ) {
    return this.post<{ exceptionId: string }>(
      this.path(tenant, store) +
        "/exceptions/" +
        encodeURIComponent(exceptionId) +
        "/resolve",
      { expectedRevision, resolution },
    );
  }
}
