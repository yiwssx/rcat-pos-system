import { DOCUMENT } from "@angular/common";
import { HttpClient, HttpParams } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  OrderInboxPage,
  MerchantStore,
  MerchantOrder,
  OrderEventPage,
  OrderHistory,
  OrderStatus,
} from "./order-board.domain";

function scopePath(tenantId: string, storeId: string): string {
  return `/api/tenants/${encodeURIComponent(tenantId)}/stores/${encodeURIComponent(storeId)}`;
}

@Injectable({ providedIn: "root" })
export class MerchantOrderApi {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private csrfToken(): string {
    const cookies = this.document.cookie.split(";").map((part) => part.trim());
    const matches = cookies.filter((part) =>
      part.startsWith("__Host-rcat_csrf="),
    );
    const token = matches[0]?.slice("__Host-rcat_csrf=".length);
    if (matches.length !== 1 || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error("กรุณายืนยันตัวตนใหม่เพื่อดำเนินรายการ");
    }
    return token;
  }

  stores(): Promise<{ stores: MerchantStore[] }> {
    return firstValueFrom(
      this.http.get<{ stores: MerchantStore[] }>("/api/auth/merchant-stores", {
        withCredentials: true,
      }),
    );
  }

  orders(
    tenantId: string,
    storeId: string,
    cursor?: string,
  ): Promise<OrderInboxPage> {
    let params = new HttpParams().set("limit", "50");
    if (cursor !== undefined) params = params.set("cursor", cursor);
    return firstValueFrom(
      this.http.get<OrderInboxPage>(scopePath(tenantId, storeId) + "/orders", {
        params,
        withCredentials: true,
      }),
    );
  }

  lookupOrders(
    tenantId: string,
    storeId: string,
    ids: readonly string[],
  ): Promise<{ orders: MerchantOrder[] }> {
    if (ids.length < 1 || ids.length > 50) {
      throw new Error("Invalid targeted recovery request");
    }
    return firstValueFrom(
      this.http.get<{ orders: MerchantOrder[] }>(
        scopePath(tenantId, storeId) + "/orders/lookup",
        {
          params: new HttpParams().set("ids", ids.join(",")),
          withCredentials: true,
        },
      ),
    );
  }

  notifications(
    tenantId: string,
    storeId: string,
    after?: string,
  ): Promise<OrderEventPage> {
    let params = new HttpParams().set("limit", "50");
    if (after !== undefined) params = params.set("after", after);
    return firstValueFrom(
      this.http.get<OrderEventPage>(
        scopePath(tenantId, storeId) + "/notifications",
        { params, withCredentials: true },
      ),
    );
  }

  notificationStreamUrl(tenantId: string, storeId: string): string {
    // Native EventSource sends the HttpOnly session cookie, not auth headers.
    // Never put session/CSRF tokens or tenant credentials in a stream URL.
    return scopePath(tenantId, storeId) + "/notifications/stream";
  }

  acknowledge(
    tenantId: string,
    storeId: string,
    eventId: string,
  ): Promise<{ acknowledgedCursor: string }> {
    return firstValueFrom(
      this.http.post<{ acknowledgedCursor: string }>(
        scopePath(tenantId, storeId) + "/notifications/ack",
        { eventId },
        {
          headers: { "X-CSRF-Token": this.csrfToken() },
          withCredentials: true,
        },
      ),
    );
  }

  transition(
    tenantId: string,
    storeId: string,
    orderId: string,
    expectedStatus: OrderStatus,
    nextStatus: OrderStatus,
  ): Promise<{ orderId: string; status: OrderStatus }> {
    return firstValueFrom(
      this.http.patch<{ orderId: string; status: OrderStatus }>(
        scopePath(tenantId, storeId) +
          "/orders/" +
          encodeURIComponent(orderId) +
          "/status",
        { expectedStatus, nextStatus },
        {
          headers: { "X-CSRF-Token": this.csrfToken() },
          withCredentials: true,
        },
      ),
    );
  }

  paymentReviewQueue(
    tenantId: string,
    storeId: string,
  ): Promise<{ items: PaymentSlipReview[] }> {
    return firstValueFrom(
      this.http.get<{ items: PaymentSlipReview[] }>(
        scopePath(tenantId, storeId) + "/payments/slips",
        { withCredentials: true },
      ),
    );
  }

  paymentSlipImage(tenantId: string, storeId: string, slipId: string): string {
    return (
      scopePath(tenantId, storeId) +
      "/payments/slips/" +
      encodeURIComponent(slipId) +
      "/image"
    );
  }

  paymentDecision(
    tenantId: string,
    storeId: string,
    slipId: string,
    payload: {
      action: "confirm" | "reject";
      expectedRevision: number;
      bankReference?: string;
      actualAmountSatang?: number;
      bankChecked?: boolean;
    },
  ): Promise<{ slipId: string; paymentState: string }> {
    return firstValueFrom(
      this.http.post<{ slipId: string; paymentState: string }>(
        scopePath(tenantId, storeId) +
          "/payments/slips/" +
          encodeURIComponent(slipId) +
          "/decision",
        payload,
        {
          headers: { "X-CSRF-Token": this.csrfToken() },
          withCredentials: true,
        },
      ),
    );
  }

  history(
    tenantId: string,
    storeId: string,
    orderId: string,
  ): Promise<OrderHistory> {
    return firstValueFrom(
      this.http.get<OrderHistory>(
        scopePath(tenantId, storeId) +
          "/orders/" +
          encodeURIComponent(orderId) +
          "/history",
        { withCredentials: true },
      ),
    );
  }
}

export interface PaymentSlipReview {
  slipId: string;
  orderId: string;
  displayNumber: string;
  amountSatang: number;
  currency: "THB";
  revision: number;
  submittedAt: string;
  state: "submitted";
}
