import { DOCUMENT } from "@angular/common";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { inject, Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  GuestTracking,
  TRACKING_ID,
  TRACKING_TOKEN,
  TRACKING_MAX_ORDERS,
  restoreTrackingList,
  validTracking,
} from "./guest-tracking.domain";
import { preparePaymentSlipPng } from "./prepare-payment-slip-png";
import {
  CartLine,
  GuestCatalogCursor,
  GuestCatalogPage,
  GuestCheckout,
  GuestOrderContext,
  normalizedOrderContext,
  GuestOrderHistory,
  GuestOrderStatus,
  GuestPaymentRequest,
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

export type PrintedStoreState =
  | { open: false; storeName: string }
  | {
      open: true;
      storeName: string;
      guestSessionId: string;
      guestToken: string;
      expiresAt: string;
    };

export interface QuickGuestOrder extends GuestOrderStatus {
  action?: "created" | "appended" | "new_after_cutoff";
  addedSatang?: number;
  replayed?: boolean;
}
type QuickCatalog = Omit<
  GuestCatalogPage,
  "visitId" | "tableId" | "tableLabel"
> & {
  guestSessionId: string;
};

// UI-only catalog identity: no synthetic Table Visit is sent to a server.
function counterCatalog(page: QuickCatalog): GuestCatalogPage {
  return {
    ...page,
    visitId: page.guestSessionId,
    tableId: null,
    tableLabel: "เคาน์เตอร์",
    entryMode: "counter",
  };
}

const TRACKING_STORAGE_KEY = "rcat-pos:guest-order-tracking:v1";
const TRACKING_LIST_KEY = "rcat-pos:guest-order-tracking-list:v2";

@Injectable({ providedIn: "root" })
export class GuestOrderApi {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

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

  async counterPage(
    token: string,
    search = "",
    categoryId: string | null = null,
    cursor: GuestCatalogCursor | null = null,
  ): Promise<GuestCatalogPage> {
    const page = await firstValueFrom(
      this.http.post<QuickCatalog>("/api/guest/ordering-store/page", {
        guestToken: token,
        search,
        categoryId,
        cursor,
        limit: 24,
      }),
    );
    return counterCatalog(page);
  }

  async counterReview(
    token: string,
    items: readonly CartLine[],
  ): Promise<GuestVisit> {
    const page = await firstValueFrom(
      this.http.post<QuickCatalog>("/api/guest/ordering-store/review-cart", {
        guestToken: token,
        items,
      }),
    );
    return counterCatalog(page);
  }

  openPrintedStore(
    tenantId: string,
    storeId: string,
    publicId: string,
  ): Promise<PrintedStoreState> {
    return firstValueFrom(
      this.http.post<PrintedStoreState>("/api/guest/ordering-store/open", {
        tenantId,
        storeId,
        publicId,
      }),
    );
  }

  quickCheckout(
    token: string,
    items: readonly CartLine[],
    context: GuestOrderContext,
    key: string,
    orderId: string | null,
  ): Promise<QuickGuestOrder & { trackingToken: string }> {
    const base = "/api/guest/ordering-store/orders";
    return firstValueFrom(
      this.http.post<QuickGuestOrder & { trackingToken: string }>(
        orderId
          ? base + "/" + encodeURIComponent(orderId) + "/add-items"
          : base,
        { guestToken: token, items, ...normalizedOrderContext(context) },
        { headers: { "Idempotency-Key": key } },
      ),
    );
  }

  quickTracking(
    token: string,
    orderId: string,
  ): Promise<{ orderId: string; trackingToken: string }> {
    return firstValueFrom(
      this.http.post<{ orderId: string; trackingToken: string }>(
        "/api/guest/ordering-store/orders/" +
          encodeURIComponent(orderId) +
          "/tracking",
        { guestToken: token },
      ),
    );
  }

  quickOrders(token: string): Promise<{ orders: QuickGuestOrder[] }> {
    return firstValueFrom(
      this.http.post<{ orders: QuickGuestOrder[] }>(
        "/api/guest/ordering-store/my-orders",
        { guestToken: token },
      ),
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
    context: GuestOrderContext,
    key: string,
  ): Promise<GuestCheckout> {
    return firstValueFrom(
      this.http.post<GuestCheckout>(
        "/api/guest/orders",
        { visitToken: token, items, ...normalizedOrderContext(context) },
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

  paymentRequest(orderId: string, token: string): Promise<GuestPaymentRequest> {
    return firstValueFrom(
      this.http.post<GuestPaymentRequest>(
        "/api/guest/orders/" + encodeURIComponent(orderId) + "/payment-request",
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
  }

  async uploadPaymentSlip(
    orderId: string,
    token: string,
    source: File,
  ): Promise<{ slipId: string; state: string; replayed: boolean }> {
    const send = (png: Blob) =>
      firstValueFrom(
        this.http.put<{ slipId: string; state: string; replayed: boolean }>(
          "/api/guest/orders/" + encodeURIComponent(orderId) + "/payment-slip",
          png,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "image/png",
            },
          },
        ),
      );
    const png = await preparePaymentSlipPng(source, this.document);
    try {
      return await send(png);
    } catch (error) {
      // If an upstream proxy explicitly rejects the size, retry once below
      // its former 256 KiB cap. Never retry an ambiguous network failure.
      if (
        error instanceof HttpErrorResponse &&
        error.status === 413 &&
        png.size > 256 * 1024
      ) {
        return send(
          await preparePaymentSlipPng(source, this.document, 256 * 1024),
        );
      }
      throw error;
    }
  }

  redeemPaymentRecovery(
    orderId: string,
    claimToken: string,
    accessToken: string,
  ): Promise<{
    orderId: string;
    displayNumber: string;
    expiresAt: string;
  }> {
    return firstValueFrom(
      this.http.post<{
        orderId: string;
        displayNumber: string;
        expiresAt: string;
      }>(
        "/api/guest/orders/" +
          encodeURIComponent(orderId) +
          "/payment-recovery/redeem",
        { claimToken, accessToken },
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
  readonly trackedOrders = signal<GuestTracking[]>([]);
  private trackingInitialized = false;
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

  keyFor(
    items: readonly CartLine[],
    context: GuestOrderContext,
    target: string | null = null,
  ): string {
    const payload = JSON.stringify({
      target,
      items,
      ...normalizedOrderContext(context),
    });
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

  saveTracking(orderId: string, token: string, displayNumber?: string): void {
    this.rememberTracking(orderId, token, displayNumber);
    this.pending = null;
    this.cart.set([]);
  }

  rememberTracking(
    orderId: string,
    token: string,
    displayNumber?: string,
    expiresAt?: number,
  ): void {
    if (!TRACKING_ID.test(orderId) || !TRACKING_TOKEN.test(token)) {
      throw new Error("ไม่สามารถบันทึกรหัสติดตามออเดอร์");
    }
    this.recoverTracking();
    const previous = this.trackedOrders().find(
      (o) => o.orderId === orderId.toLowerCase(),
    );
    if (
      previous &&
      previous.expiresAt === undefined &&
      expiresAt !== undefined
    ) {
      this.selectTracking(previous.orderId);
      return;
    }
    const entry: GuestTracking = {
      orderId: orderId.toLowerCase(),
      trackingToken: token,
      createdAt: Date.now(),
      ...(displayNumber ? { displayNumber } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(previous?.summary ? { summary: previous.summary } : {}),
    };
    if (!validTracking(entry, Date.now())) throw new Error("รหัสติดตามหมดอายุ");
    this.trackedOrders.set(
      [
        entry,
        ...this.trackedOrders().filter((o) => o.orderId !== entry.orderId),
      ].slice(0, TRACKING_MAX_ORDERS),
    );
    this.tracking.set(entry);
    this.persistTracking();
  }

  private persistTracking(): void {
    // Keep the independent capabilities in this tab only, never localStorage,
    // public URLs, or a list derived from the shared table QR.
    try {
      const storage = this.window?.sessionStorage;
      storage?.setItem(TRACKING_LIST_KEY, JSON.stringify(this.trackedOrders()));
      const active = this.tracking();
      if (active)
        storage?.setItem(TRACKING_STORAGE_KEY, JSON.stringify(active));
      else storage?.removeItem(TRACKING_STORAGE_KEY);
    } catch {
      // In-memory tracking still works when storage is disabled.
    }
  }

  recoverTracking(): GuestTracking | null {
    if (!this.trackingInitialized) {
      this.trackingInitialized = true;
      try {
        const storage = this.window?.sessionStorage;
        const restored = restoreTrackingList(
          storage?.getItem(TRACKING_LIST_KEY) ?? null,
          storage?.getItem(TRACKING_STORAGE_KEY) ?? null,
          Date.now(),
        );
        this.trackedOrders.set(restored.orders);
        this.tracking.set(restored.active);
        this.persistTracking();
      } catch {
        /* Disabled browser storage; keep in-memory state. */
      }
    }
    const now = Date.now();
    const prev = this.trackedOrders();
    const valid = prev.filter((o) => !!validTracking(o, now));
    const active =
      valid.find((o) => o.orderId === this.tracking()?.orderId) ??
      valid[0] ??
      null;
    if (valid.length !== prev.length || active !== this.tracking()) {
      this.trackedOrders.set(valid);
      this.tracking.set(active);
      this.persistTracking();
    }
    return active;
  }

  selectTracking(orderId: string): boolean {
    this.recoverTracking();
    const selected = this.trackedOrders().find((o) => o.orderId === orderId);
    if (!selected) return false;
    this.tracking.set(selected);
    this.persistTracking();
    return true;
  }

  updateTrackingSummary(status: GuestOrderStatus, token: string): void {
    const found = this.trackedOrders().find(
      (o) => o.orderId === status.orderId && o.trackingToken === token,
    );
    if (!found) return;
    const next: GuestTracking = {
      ...found,
      displayNumber: status.displayNumber,
      summary: {
        amountSatang: status.amountSatang,
        status: status.status,
        paymentState: status.paymentState,
        checkedAt: Date.now(),
      },
    };
    this.trackedOrders.update((orders) =>
      orders.map((o) => (o === found ? next : o)),
    );
    if (
      this.tracking()?.orderId === next.orderId &&
      this.tracking()?.trackingToken === token
    )
      this.tracking.set(next);
    this.persistTracking();
  }

  clearTracking(): void {
    this.trackingInitialized = true;
    this.tracking.set(null);
    this.trackedOrders.set([]);
    try {
      this.window?.sessionStorage.removeItem(TRACKING_STORAGE_KEY);
      this.window?.sessionStorage.removeItem(TRACKING_LIST_KEY);
    } catch {
      /* No persistent store may be available. */
    }
  }
}
