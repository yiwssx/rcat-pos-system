import { DOCUMENT } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HttpErrorResponse } from "@angular/common/http";
import {
  appendOrderPage,
  formatSatang,
  hasEventCoverage,
  mergeEvents,
  MerchantOrder,
  MerchantRole,
  MerchantStore,
  OrderAction,
  OrderEvent,
  OrderHistory,
  OrderStatus,
  orderActions,
  ROLE_LABEL,
  STATUS_LABEL,
} from "./order-board.domain";
import { MerchantOrderApi } from "./merchant-order.api";

const POLL_MS = 10_000;
const MAX_CATCHUP_PAGES = 6;
const MAX_INBOX_PAGES = 20; // Explicit bounded recovery; retain outbox until complete.

function failureText(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต";
    if (error.status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
    if (error.status === 403 || error.status === 404) {
      return "ไม่มีสิทธิ์เข้าถึงร้านหรือดำเนินรายการนี้";
    }
    if (error.status === 409) {
      return "ออเดอร์ถูกเปลี่ยนจากอีกอุปกรณ์แล้ว กำลังโหลดสถานะล่าสุด";
    }
  }
  return error instanceof Error
    ? error.message
    : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่";
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrls: ["./order-board.css"],
  template: `
    <section class="board" aria-labelledby="board-title">
      <div class="board-head">
        <div>
          <a routerLink="/" class="board-back">← เปลี่ยนร้าน</a>
          <span class="eyebrow">MERCHANT / ORDER OPERATIONS</span>
          <h1 id="board-title">กระดานออเดอร์</h1>
          <p class="lede">
            {{ store()?.storeName || "กำลังตรวจสอบสิทธิ์ร้าน" }}
            @if (store()) {
              <span>· {{ roleLabel[store()!.role] }}</span>
            }
          </p>
        </div>
        <button
          type="button"
          class="primary-link board-refresh"
          [disabled]="refreshing()"
          (click)="refresh()"
        >
          {{ refreshing() ? "กำลังซิงก์..." : "รีเฟรชออเดอร์" }}
        </button>
      </div>

      <p class="board-notice">
        การรับออเดอร์ไม่ใช่การรับชำระเงิน · สถานะ Payment ยังไม่เปิดใช้งาน
      </p>

      <div class="board-connection" role="status" aria-live="polite">
        <span
          class="connection-indicator"
          [class.is-offline]="!connected()"
        ></span>
        {{
          connected()
            ? "เชื่อมต่ออยู่ · ตรวจออเดอร์ทุก 10 วินาที"
            : "ออฟไลน์ · รอเชื่อมต่ออีกครั้ง"
        }}
        @if (lastSynced()) {
          <span
            >· ซิงก์ล่าสุด {{ lastSynced()!.toLocaleTimeString("th-TH") }}</span
          >
        }
      </div>

      @if (error()) {
        <div class="board-alert" role="alert">
          {{ error() }}
          <button type="button" (click)="refresh()" [disabled]="refreshing()">
            ลองอีกครั้ง
          </button>
        </div>
      }
      @if (warning()) {
        <div class="board-warning" role="status">{{ warning() }}</div>
      }

      @if (!store() && !error()) {
        <p class="board-empty" role="status">
          กำลังตรวจสอบข้อมูลร้านและสิทธิ์พนักงาน...
        </p>
      } @else if (store()) {
        <div class="board-metrics" aria-label="สรุปออเดอร์ที่แสดง">
          <div>
            <strong>{{ pendingCount() }}</strong
            ><span>รอรับออเดอร์</span>
          </div>
          <div>
            <strong>{{ preparingCount() }}</strong
            ><span>รับแล้ว / กำลังเตรียม</span>
          </div>
          <div>
            <strong>{{ servedCount() }}</strong
            ><span>เสิร์ฟแล้ว</span>
          </div>
        </div>

        <div class="board-controls">
          <h2>รายการออเดอร์</h2>
          <label for="order-filter">กรองสถานะ</label>
          <select
            id="order-filter"
            [value]="filter()"
            (change)="changeFilter($event)"
          >
            <option value="active">ออเดอร์ที่กำลังดำเนินงาน</option>
            <option value="all">ทั้งหมดที่โหลด</option>
            <option value="submitted">รอรับ</option>
            <option value="accepted">รับแล้ว</option>
            <option value="preparing">กำลังเตรียม</option>
            <option value="served">เสิร์ฟแล้ว</option>
            <option value="cancelled">ยกเลิก</option>
          </select>
        </div>
        <p class="board-connection" role="status">
          กำลังแสดง {{ orders().length }} ออเดอร์ที่โหลด
          · สรุปด้านบนคำนวณจากรายการที่โหลดเท่านั้น
        </p>
        @if (visibleOrders().length === 0) {
          <p class="board-empty" role="status">
            {{
              refreshing()
                ? "กำลังเรียกข้อมูลออเดอร์..."
                : "ไม่มีออเดอร์ในสถานะนี้"
            }}
          </p>
        } @else {
          <div class="order-grid">
            @for (order of visibleOrders(); track order.orderId) {
              <article
                class="order-card"
                [class.is-submitted]="order.status === 'submitted'"
                [attr.aria-label]="'ออเดอร์ ' + order.orderId.slice(0, 8)"
              >
                <div class="order-card-head">
                  <div>
                    <span class="order-number"
                      >#{{ order.orderId.slice(0, 8) }}</span
                    >
                    <p class="order-meta">
                      โต๊ะ {{ order.tableId.slice(0, 8) }} ·
                      {{ time(order.createdAt) }}
                    </p>
                  </div>
                  <span
                    class="order-state"
                    [class]="'order-state state-' + order.status"
                  >
                    {{ statusLabel[order.status] }}
                  </span>
                </div>
                <ul class="order-items">
                  @for (item of order.items; track $index) {
                    <li>
                      <div class="item-top">
                        <span
                          ><strong>{{ item.quantity }}×</strong>
                          {{ item.productName }}</span
                        >
                        <span class="money"
                          >{{ money(item.lineTotalSatang) }} ฿</span
                        >
                      </div>
                      @if (item.options.length) {
                        <p class="order-options">
                          @for (opt of item.options; track $index) {
                            {{ opt.name }}{{ !$last ? " · " : "" }}
                          }
                        </p>
                      }
                    </li>
                  }
                </ul>
                <div class="order-total">
                  <span>ยอดออเดอร์ (ยังไม่ชำระเงิน)</span>
                  <strong class="money"
                    >{{ money(order.amountSatang) }} ฿</strong
                  >
                </div>
                <div class="order-actions">
                  @for (
                    action of actions(order.status);
                    track action.nextStatus
                  ) {
                    <button
                      type="button"
                      [class.danger]="action.destructive"
                      [disabled]="busyId() !== null || !connected()"
                      (click)="transition(order, action)"
                    >
                      {{
                        busyId() === order.orderId
                          ? "กำลังบันทึก..."
                          : action.label
                      }}
                    </button>
                  }
                  <button
                    type="button"
                    class="subtle"
                    [disabled]="historyLoadingId() === order.orderId"
                    (click)="showHistory(order)"
                  >
                    {{
                      historyLoadingId() === order.orderId
                        ? "กำลังโหลด..."
                        : "ดูประวัติ"
                    }}
                  </button>
                </div>
                @if (selectedHistoryId() === order.orderId && history()) {
                  <section
                    class="order-history"
                    aria-label="ประวัติการเปลี่ยนสถานะ"
                  >
                    <h3>ประวัติออเดอร์</h3>
                    <ol>
                      @for (entry of history()!.events; track $index) {
                        <li>
                          <strong>{{ statusLabel[entry.status] }}</strong>
                          <span>{{ time(entry.occurredAt) }}</span>
                        </li>
                      }
                    </ol>
                  </section>
                }
              </article>
            }
          </div>
        }

        @if (hasMoreOrders()) {
          <div class="board-more">
            <button type="button" (click)="loadOlderOrders()"
              [disabled]="refreshing() || !connected() || loadedPages() >= maxInboxPages">
              {{ loadedPages() >= maxInboxPages
                  ? "ถึงขีดจำกัดโหลดต่อรอบ"
                  : "โหลดออเดอร์เก่าเพิ่มอีก 50 รายการ" }}
            </button>
            @if (loadedPages() >= maxInboxPages) {
              <p role="status">ยังมีรายการเก่ากว่านี้ ต้องใช้การค้นหาและรายงานย้อนหลังในระยะถัดไป</p>
            }
          </div>
        }

        <section class="board-events" aria-labelledby="events-title">
          <div class="board-controls">
            <h2 id="events-title">เหตุการณ์ล่าสุด</h2>
            <span>มาจาก Outbox ที่บันทึกในฐานข้อมูล</span>
          </div>
          @if (events().length === 0) {
            <p class="board-empty">
              ยังไม่มีเหตุการณ์ใหม่ที่รับจาก Outbox ในหน้าจอนี้
            </p>
          } @else {
            <ol class="event-list">
              @for (event of events(); track event.eventId) {
                <li>
                  <span class="event-type">{{
                    statusLabel[event.status]
                  }}</span>
                  <span>ออเดอร์ #{{ event.orderId.slice(0, 8) }}</span>
                  <time>{{ time(event.occurredAt) }}</time>
                </li>
              }
            </ol>
          }
        </section>
      }
    </section>
  `,
})
export class MerchantOrderBoardPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(MerchantOrderApi);
  private readonly document = inject(DOCUMENT);
  private readonly win = this.document.defaultView;
  private interval?: ReturnType<typeof setInterval>;
  private disposed = false;
  private inFlight = false;
  private tenantId = "";
  private storeId = "";

  readonly store = signal<MerchantStore | null>(null);
  readonly orders = signal<MerchantOrder[]>([]);
  readonly hasMoreOrders = signal(false);
  readonly loadedPages = signal(1);
  readonly maxInboxPages = MAX_INBOX_PAGES;
  readonly events = signal<OrderEvent[]>([]);
  readonly error = signal("");
  readonly warning = signal("");
  readonly refreshing = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly lastSynced = signal<Date | null>(null);
  readonly connected = signal(true);
  readonly filter = signal("active");
  readonly history = signal<OrderHistory | null>(null);
  readonly selectedHistoryId = signal<string | null>(null);
  readonly historyLoadingId = signal<string | null>(null);
  readonly statusLabel = STATUS_LABEL;
  readonly roleLabel = ROLE_LABEL;
  readonly money = formatSatang;

  readonly visibleOrders = computed(() => {
    const filter = this.filter();
    return this.orders().filter((order) =>
      filter === "all"
        ? true
        : filter === "active"
          ? order.status !== "served" && order.status !== "cancelled"
          : order.status === filter,
    );
  });
  readonly pendingCount = computed(
    () => this.orders().filter((o) => o.status === "submitted").length,
  );
  readonly preparingCount = computed(
    () =>
      this.orders().filter(
        (o) => o.status === "accepted" || o.status === "preparing",
      ).length,
  );
  readonly servedCount = computed(
    () => this.orders().filter((o) => o.status === "served").length,
  );

  ngOnInit(): void {
    this.tenantId = this.route.snapshot.paramMap.get("tenantId") ?? "";
    this.storeId = this.route.snapshot.paramMap.get("storeId") ?? "";
    this.connected.set(this.win?.navigator.onLine ?? true);
    this.win?.addEventListener("online", this.resume);
    this.win?.addEventListener("offline", this.goOffline);
    this.win?.addEventListener("focus", this.resume);
    this.document.addEventListener("visibilitychange", this.resume);
    this.interval = setInterval(() => {
      if (this.document.visibilityState === "visible" && this.connected()) {
        void this.refresh();
      }
    }, POLL_MS);
    void this.initialize();
  }

  ngOnDestroy(): void {
    this.disposed = true;
    if (this.interval) clearInterval(this.interval);
    this.win?.removeEventListener("online", this.resume);
    this.win?.removeEventListener("offline", this.goOffline);
    this.win?.removeEventListener("focus", this.resume);
    this.document.removeEventListener("visibilitychange", this.resume);
  }

  private readonly goOffline = () => {
    this.connected.set(false);
    this.warning.set("การเชื่อมต่อขาด · รายการบนจออาจไม่ใช่สถานะล่าสุด");
  };

  private readonly resume = () => {
    this.connected.set(this.win?.navigator.onLine ?? true);
    if (this.document.visibilityState === "visible" && this.connected()) {
      void this.refresh();
    }
  };

  private async initialize(): Promise<void> {
    try {
      const data = await this.api.stores();
      if (this.disposed) return;
      const selected = data.stores.find(
        (store) =>
          store.tenantId === this.tenantId && store.storeId === this.storeId,
      );
      if (!selected) {
        this.error.set("บัญชีนี้ไม่มีสิทธิ์เปิดร้านดังกล่าว");
        return;
      }
      this.store.set(selected);
      await this.refresh();
    } catch (error) {
      if (!this.disposed) this.error.set(failureText(error));
    }
  }

  changeFilter(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLSelectElement) this.filter.set(target.value);
  }

  actions(status: OrderStatus): readonly OrderAction[] {
    const role: MerchantRole = this.store()?.role ?? "kitchen";
    return orderActions(status, role);
  }

  time(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString("th-TH", {
          dateStyle: "short",
          timeStyle: "short",
        });
  }

  // Load keyset pages until either a) the operator's requested history is
  // visible or b) each Outbox event being acknowledged is covered by an
  // authoritative Order snapshot. A bounded scan leaves older events unacked.
  private async authoritativePages(
    requiredOrderIds: ReadonlySet<string>,
    minimumPages: number,
  ): Promise<{
    orders: MerchantOrder[];
    hasMore: boolean;
    pages: number;
    covered: boolean;
  }> {
    let response = await this.api.orders(this.tenantId, this.storeId);
    let orders = response.orders;
    let pages = 1;
    const covered = () =>
      [...requiredOrderIds].every((id) =>
        orders.some((order) => order.orderId === id),
      );
    while (
      !this.disposed &&
      response.hasMore &&
      response.nextCursor &&
      pages < MAX_INBOX_PAGES &&
      (pages < minimumPages || !covered())
    ) {
      const cursor = response.nextCursor;
      const next = await this.api.orders(this.tenantId, this.storeId, cursor);
      if (next.orders.length === 0) {
        throw new Error("Cursor ออเดอร์ไม่สอดคล้องกับข้อมูลร้าน");
      }
      orders = appendOrderPage(orders, next.orders);
      pages += 1;
      response = next;
    }
    return { orders, hasMore: response.hasMore, pages, covered: covered() };
  }

  async loadOlderOrders(): Promise<void> {
    if (this.refreshing() || !this.hasMoreOrders() ||
        this.loadedPages() >= MAX_INBOX_PAGES) return;
    this.loadedPages.update((pages) => pages + 1);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.disposed || this.inFlight || !this.store() || !this.connected()) {
      return;
    }
    this.inFlight = true;
    this.refreshing.set(true);
    this.error.set("");
    try {
      // Never acknowledge from a cached client list. Read current statuses
      // from the server and fetch further keyset pages as necessary.
      let snapshot = await this.authoritativePages(
        new Set<string>(), this.loadedPages(),
      );
      if (this.disposed) return;
      this.orders.set(snapshot.orders);
      this.hasMoreOrders.set(snapshot.hasMore);
      let after: string | undefined;
      let exhausted = false;
      for (let page = 0; page < MAX_CATCHUP_PAGES; page += 1) {
        const batch = await this.api.notifications(
          this.tenantId,
          this.storeId,
          after,
        );
        if (this.disposed) return;
        if (batch.events.length === 0) {
          exhausted = true;
          break;
        }
        // Outbox IDs are commit ordered per store. Fetch the matching Orders
        // with precise keyset pagination AFTER receiving this batch.
        snapshot = await this.authoritativePages(
          new Set(batch.events.map((event) => event.orderId)),
          this.loadedPages(),
        );
        if (this.disposed) return;
        this.orders.set(snapshot.orders);
        this.hasMoreOrders.set(snapshot.hasMore);
        this.loadedPages.update((count) => Math.max(count, snapshot.pages));
        if (!snapshot.covered ||
          !hasEventCoverage(batch.events, snapshot.orders)) {
          this.warning.set(
            "ออเดอร์ย้อนหลังเกินขีดจำกัดการกู้คืนรอบนี้ เหตุการณ์ยังไม่ถูกยืนยันรับทราบ",
          );
          break;
        }
        this.events.update((seen) => mergeEvents(seen, batch.events));
        // Ack follows committed, authoritative display only. Retry on any
        // network/CSRF failure; monotonic server cursors deduplicate.
        await this.api.acknowledge(
          this.tenantId,
          this.storeId,
          batch.nextCursor,
        );
        after = batch.nextCursor;
        if (!batch.hasMore) {
          exhausted = true;
          break;
        }
      }
      if (!this.disposed) {
        if (exhausted) this.warning.set("");
        if (!exhausted && !this.warning()) {
          this.warning.set("มีเหตุการณ์สะสมจำนวนมาก ระบบจะทยอยโหลดรอบถัดไป");
        }
        this.lastSynced.set(new Date());
      }
    } catch (error) {
      if (!this.disposed) this.error.set(failureText(error));
    } finally {
      this.inFlight = false;
      if (!this.disposed) this.refreshing.set(false);
    }
  }

  async transition(order: MerchantOrder, action: OrderAction): Promise<void> {
    if (this.busyId() !== null || !this.connected()) return;
    if (
      action.destructive &&
      !this.win?.confirm("ยืนยันยกเลิกออเดอร์นี้? การยกเลิกไม่ใช่การคืนเงิน")
    ) {
      return;
    }
    this.busyId.set(order.orderId);
    this.error.set("");
    try {
      await this.api.transition(
        this.tenantId,
        this.storeId,
        order.orderId,
        order.status,
        action.nextStatus,
      );
      // Never optimistically change status: another device may have won the
      // compare-and-swap, or this role may not have the requested permission.
    } catch (error) {
      if (!this.disposed) this.error.set(failureText(error));
    } finally {
      if (!this.disposed) this.busyId.set(null);
      await this.refresh();
    }
  }

  async showHistory(order: MerchantOrder): Promise<void> {
    if (this.selectedHistoryId() === order.orderId) {
      this.selectedHistoryId.set(null);
      this.history.set(null);
      return;
    }
    this.selectedHistoryId.set(order.orderId);
    this.history.set(null);
    this.historyLoadingId.set(order.orderId);
    try {
      const result = await this.api.history(
        this.tenantId,
        this.storeId,
        order.orderId,
      );
      if (!this.disposed && this.selectedHistoryId() === order.orderId) {
        this.history.set(result);
      }
    } catch (error) {
      if (!this.disposed) this.error.set(failureText(error));
    } finally {
      if (!this.disposed) this.historyLoadingId.set(null);
    }
  }
}
