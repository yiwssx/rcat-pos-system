import { DOCUMENT } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { inject, Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  CartLine,
  GuestCatalogCursor,
  GuestCatalogPage,
  GuestCheckout,
  GuestOrderHistory,
  GuestOrderStatus,
  GuestVisit,
} from "./guest-order.domain";

export type PrintedTableState =
  | { open: false; storeName: string; tableLabel: string }
  | {
      open: true;
      storeName: string;
      tableLabel: string;
      visitToken: string;
      expiresAt: string;
    };

interface GuestTracking {
  orderId: string;
  trackingToken: string;
  createdAt: number;
}
const TRACKING_STORAGE_KEY = "rcat-pos:guest-order-tracking:v1";
const TRACKING_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

@Injectable({ providedIn: "root" })
export class GuestOrderApi {
  private readonly http = inject(HttpClient);

  resolve(token: string): Promise<GuestVisit> {
    return firstValueFrom(
      this.http.post<GuestVisit>("/api/guest/ordering-visit/resolve", {
        token,
      }),
    );
  }

  page(
    token: string,
    search = "",
    categoryId: string | null = null,
    cursor: GuestCatalogCursor | null = null,
  ): Promise<GuestCatalogPage> {
    return firstValueFrom(
      this.http.post<GuestCatalogPage>("/api/guest/ordering-visit/page", {
        token,
        search,
        categoryId,
        cursor,
        limit: 24,
      }),
    );
  }

  openPrintedTable(
    tenantId: string,
    storeId: string,
    tableId: string,
  ): Promise<PrintedTableState> {
    return firstValueFrom(
      this.http.post<PrintedTableState>("/api/guest/ordering-table/open", {
        tenantId,
        storeId,
        tableId,
      }),
    );
  }

  redeemCode(
    tenantId: string,
    storeId: string,
    tableId: string,
    code: string,
  ): Promise<{ visitToken: string; expiresAt: string }> {
    return firstValueFrom(
      this.http.post<{ visitToken: string; expiresAt: string }>(
        "/api/guest/ordering-code/redeem",
        { tenantId, storeId, tableId, code },
      ),
    );
  }

  reviewCart(token: string, items: readonly CartLine[]): Promise<GuestVisit> {
    return firstValueFrom(
      this.http.post<GuestVisit>("/api/guest/ordering-visit/review-cart", {
        token,
        items,
      }),
    );
  }

  checkout(
    token: string,
    items: readonly CartLine[],
    key: string,
  ): Promise<GuestCheckout> {
    return firstValueFrom(
      this.http.post<GuestCheckout>(
        "/api/guest/orders",
        { visitToken: token, items },
        { headers: { "Idempotency-Key": key } },
      ),
    );
  }

  status(orderId: string, token: string): Promise<GuestOrderStatus> {
    return firstValueFrom(
      this.http.get<GuestOrderStatus>(
        "/api/guest/orders/" + encodeURIComponent(orderId) + "/status",
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
  }

  history(orderId: string, token: string): Promise<GuestOrderHistory> {
    return firstValueFrom(
      this.http.get<GuestOrderHistory>(
        "/api/guest/orders/" + encodeURIComponent(orderId) + "/history",
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
  }
}

@Injectable({ providedIn: "root" })
export class GuestOrderSession {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  readonly visit = signal<GuestVisit | null>(null);
  readonly visitToken = signal<string | null>(null);
  readonly cart = signal<CartLine[]>([]);
  readonly tracking = signal<GuestTracking | null>(null);
  private pending: { key: string; payload: string } | null = null;

  setPage(token: string, page: GuestCatalogPage): void {
    const old = this.visit();
    if (!old || this.visitToken() !== token || old.visitId !== page.visitId) {
      this.setVisit(token, page);
      return;
    }
    // Selected cart items keep the exact product/modifier snapshot originally
    // reviewed by the guest, even when a filter/page refresh sees new data.
    // Checkout compares those against the authoritative fresh full resolver.
    const frozenProducts = new Set(this.cart().map((line) => line.productId));
    const mergeById = <T extends { id: string }>(
      previous: T[],
      incoming: T[],
      freeze: (value: T) => boolean,
    ): T[] => {
      const rows = new Map(previous.map((value) => [value.id, value]));
      for (const value of incoming) {
        const prior = rows.get(value.id);
        if (!prior || !freeze(prior)) rows.set(value.id, value);
      }
      return [...rows.values()];
    };
    this.visit.set({
      ...old,
      ...page,
      categories: this.cart().length ? old.categories : page.categories,
      products: mergeById(old.products, page.products, (value) =>
        frozenProducts.has(value.id),
      ),
      modifierGroups: mergeById(
        old.modifierGroups,
        page.modifierGroups,
        (value) => frozenProducts.has(value.productId),
      ),
      modifierOptions: mergeById(
        old.modifierOptions,
        page.modifierOptions,
        (value) => frozenProducts.has(value.productId),
      ),
    });
  }

  setVisit(token: string, visit: GuestVisit): void {
    // A new QR replaces the current cart, preventing cross-table checkout.
    if (
      this.visit()?.visitId !== visit.visitId ||
      this.visitToken() !== token
    ) {
      this.cart.set([]);
      this.pending = null;
    }
    this.visitToken.set(token);
    this.visit.set(visit);
  }

  invalidateVisit(): void {
    this.visitToken.set(null);
    this.visit.set(null);
    this.cart.set([]);
    this.pending = null;
  }

  setCart(next: CartLine[]): void {
    this.cart.set(next);
    this.pending = null;
  }

  keyFor(items: readonly CartLine[]): string {
    const payload = JSON.stringify(items);
    if (this.pending?.payload === payload) return this.pending.key;
    if (!this.window?.crypto?.randomUUID) {
      throw new Error(
        "เบราว์เซอร์นี้ไม่รองรับการสร้างรหัสคำสั่งซื้อที่ปลอดภัย",
      );
    }
    const key = this.window.crypto.randomUUID();
    this.pending = { key, payload };
    return key;
  }

  saveTracking(orderId: string, token: string): void {
    if (!ID.test(orderId) || !TOKEN.test(token)) {
      throw new Error("ไม่สามารถบันทึกรหัสติดตามออเดอร์");
    }
    const tracking: GuestTracking = {
      orderId,
      trackingToken: token,
      createdAt: Date.now(),
    };
    this.tracking.set(tracking);
    // Tab-scoped only (not localStorage or URL). A new tab cannot silently
    // read someone else's order. Tokens remain inaccessible to server logs.
    try {
      this.window?.sessionStorage.setItem(
        TRACKING_STORAGE_KEY,
        JSON.stringify(tracking),
      );
    } catch {
      // In-memory tracking still works when storage is disabled.
    }
    this.pending = null;
    this.cart.set([]);
  }

  recoverTracking(): GuestTracking | null {
    const current = this.tracking();
    if (current && Date.now() - current.createdAt < TRACKING_MAX_AGE_MS)
      return current;
    if (current) this.clearTracking();
    try {
      const raw = this.window?.sessionStorage.getItem(TRACKING_STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object")
        throw new Error("Invalid tracking");
      const item = parsed as Record<string, unknown>;
      if (
        typeof item["orderId"] !== "string" ||
        typeof item["trackingToken"] !== "string" ||
        !ID.test(item["orderId"]) ||
        !TOKEN.test(item["trackingToken"]) ||
        typeof item["createdAt"] !== "number" ||
        !Number.isFinite(item["createdAt"]) ||
        Date.now() - item["createdAt"] > TRACKING_MAX_AGE_MS ||
        item["createdAt"] > Date.now()
      ) {
        throw new Error("Invalid tracking");
      }
      const recovered = item as unknown as GuestTracking;
      this.tracking.set(recovered);
      return recovered;
    } catch {
      this.clearTracking();
      return null;
    }
  }

  clearTracking(): void {
    this.tracking.set(null);
    try {
      this.window?.sessionStorage.removeItem(TRACKING_STORAGE_KEY);
    } catch {
      // No persistent store may be available.
    }
  }
}
