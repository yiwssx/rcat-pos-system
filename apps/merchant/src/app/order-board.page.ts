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
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmCard } from "@spartan-ng/helm/card";
import { HlmLabel } from "@spartan-ng/helm/label";
import { HlmNativeSelect } from "@spartan-ng/helm/native-select";
import { HttpErrorResponse } from "@angular/common/http";
import {
  appendOrderPage,
  formatSatang,
  formatOrderNumber,
  hasEventCoverage,
  mergeEvents,
  missingOrderIds,
  MerchantOrder,
  MerchantRole,
  MerchantStore,
  OrderAction,
  OrderEvent,
  OrderHistory,
  OrderStatus,
  PAYMENT_STATUS_LABEL,
  orderActions,
  ROLE_LABEL,
  STATUS_LABEL,
} from "./order-board.domain";
import { MerchantOrderApi, OperationalBill } from "./merchant-order.api";

const POLL_MS = 10_000;
const SSE_RECONCILE_MS = 60_000;
const SSE_EVENT_DEBOUNCE_MS = 500;
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
      const response = error.error as { message?: unknown } | null;
      const message =
        typeof response?.message === "string" ? response.message : "";
      if (message.includes("Insufficient tracked stock")) {
        return "วัตถุดิบในสต็อกไม่เพียงพอ ออเดอร์ยังไม่ถูกรับ กรุณาเติมสต็อกแล้วลองใหม่";
      }
      if (message.includes("Tracked product recipe is incomplete")) {
        return "สูตรวัตถุดิบของสินค้าที่ยังติดตามไม่สมบูรณ์ กรุณาตรวจสอบสูตรก่อนรับออเดอร์";
      }
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
  imports: [
    RouterLink,
    HlmBadge,
    HlmButton,
    HlmCard,
    HlmLabel,
    HlmNativeSelect,
  ],
  template: `
    <section
      class="mx-auto box-border w-full max-w-7xl space-y-3 pb-8 sm:space-y-4"
      aria-labelledby="board-title"
    >
      <header
        class="mb-2 flex min-w-0 items-start justify-between gap-2 rounded-2xl bg-action p-3 text-action-foreground sm:mb-4 sm:items-center sm:gap-4 sm:p-5"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <a hlmBtn routerLink="/" variant="outline">← เปลี่ยนร้าน</a>
          <span
            class="hidden text-xs font-semibold uppercase tracking-widest text-action-foreground sm:block"
            >ORDER MANAGEMENT</span
          >
          <h1
            id="board-title"
            class="text-2xl font-semibold tracking-tight text-action-foreground sm:text-3xl"
          >
            กระดานออเดอร์
          </h1>
          <p class="text-sm leading-relaxed text-action-foreground">
            {{ store()?.storeName || "กำลังตรวจสอบสิทธิ์ร้าน" }}
            @if (store()) {
              <span>· {{ roleLabel[store()!.role] }}</span>
            }
          </p>
        </div>
        <button
          hlmBtn
          type="button"
          variant="outline"
          class="min-h-11 w-11 shrink-0 gap-2 sm:w-auto"
          [attr.aria-label]="
            refreshing() ? 'กำลังซิงก์ออเดอร์' : 'รีเฟรชออเดอร์'
          "
          [disabled]="refreshing() || !connected()"
          (click)="refresh()"
        >
          <span aria-hidden="true">↻</span>
          <span class="hidden sm:inline">{{
            refreshing() ? "กำลังซิงก์..." : "รีเฟรชออเดอร์"
          }}</span>
        </button>
      </header>

      <div
        class="my-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 sm:p-3 text-sm leading-relaxed text-foreground"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          class="size-2.5 shrink-0 rounded-full"
          [class.bg-served-line]="connected()"
          [class.bg-destructive]="!connected()"
        ></span>
        {{
          !connected()
            ? "ออฟไลน์ · รอเชื่อมต่ออีกครั้ง"
            : streamState() === "streaming"
              ? "เชื่อมต่อแล้ว · ออเดอร์แจ้งอัตโนมัติ"
              : streamState() === "connecting"
                ? "กำลังเชื่อมต่อ · ตรวจสอบสำรอง"
                : streamState() === "blocked"
                  ? "ถูกตัดสิทธิ์การแจ้งเตือน · กรุณาเข้าสู่ระบบใหม่"
                  : streamState() === "paused"
                    ? "พักการแจ้งเตือน · ซิงก์เมื่อกลับมา"
                    : "กำลังเชื่อมต่อใหม่ · ตรวจสอบสำรอง"
        }}
        @if (lastSynced()) {
          <span
            >· ซิงก์ล่าสุด {{ lastSynced()!.toLocaleTimeString("th-TH") }}</span
          >
        }
      </div>

      <p
        class="my-2 rounded-xl border border-border bg-muted/40 p-2 text-sm leading-relaxed text-foreground"
      >
        รับและเตรียมอาหารได้ทันที · สถานะชำระเงินแยกจากงานครัว
      </p>

      @if (error()) {
        <div
          class="my-3 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-danger-soft p-4 text-sm leading-relaxed text-foreground"
          role="alert"
        >
          <span class="min-w-0 flex-1">{{ error() }}</span>
          <button
            hlmBtn
            type="button"
            variant="outline"
            class="min-h-11"
            (click)="refresh()"
            [disabled]="refreshing()"
          >
            ลองอีกครั้ง
          </button>
        </div>
      }
      @if (warning()) {
        <div
          class="my-3 rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed"
          role="status"
        >
          {{ warning() }}
        </div>
      }

      @if (!store() && !error()) {
        <p
          class="my-4 rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm leading-relaxed text-muted-foreground"
          role="status"
        >
          กำลังตรวจสอบข้อมูลร้านและสิทธิ์พนักงาน...
        </p>
      } @else if (store()) {
        <div
          class="my-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2 sm:gap-3"
          aria-label="กรองออเดอร์ตามสถานะ"
        >
          <button
            hlmBtn
            type="button"
            variant="outline"
            class="grid min-h-16 min-w-0 justify-items-start gap-1 rounded-xl border-input bg-incoming hover:bg-incoming px-2 py-2 text-left text-foreground sm:px-4 sm:py-3"
            [class.border-primary-line]="filter() === 'submitted'"
            [class.ring-2]="filter() === 'submitted'"
            [attr.aria-pressed]="filter() === 'submitted'"
            (click)="setQueueFilter('submitted')"
          >
            <span
              class="whitespace-normal text-xs font-medium text-current sm:text-sm"
              >รอรับออเดอร์</span
            >
            <strong class="text-2xl font-semibold tabular-nums text-current">{{
              pendingCount()
            }}</strong>
            <small class="hidden text-xs font-normal text-current sm:block"
              >แตะเพื่อดูรายการใหม่</small
            >
          </button>
          <button
            hlmBtn
            type="button"
            variant="outline"
            class="grid min-h-16 min-w-0 justify-items-start gap-1 rounded-xl border-input bg-preparing hover:bg-preparing px-2 py-2 text-left text-foreground sm:px-4 sm:py-3"
            [class.border-primary-line]="filter() === 'in_progress'"
            [class.ring-2]="filter() === 'in_progress'"
            [attr.aria-pressed]="filter() === 'in_progress'"
            (click)="setQueueFilter('in_progress')"
          >
            <span
              class="whitespace-normal text-xs font-medium text-current sm:text-sm"
              >กำลังดำเนินงาน</span
            >
            <strong class="text-2xl font-semibold tabular-nums text-current">{{
              preparingCount()
            }}</strong>
            <small class="hidden text-xs font-normal text-current sm:block"
              >รับแล้ว / กำลังเตรียม</small
            >
          </button>
          <button
            hlmBtn
            type="button"
            variant="outline"
            class="grid min-h-16 min-w-0 justify-items-start gap-1 rounded-xl border-input bg-served hover:bg-served px-2 py-2 text-left text-foreground sm:px-4 sm:py-3"
            [class.border-primary-line]="filter() === 'served'"
            [class.ring-2]="filter() === 'served'"
            [attr.aria-pressed]="filter() === 'served'"
            (click)="setQueueFilter('served')"
          >
            <span
              class="whitespace-normal text-xs font-medium text-current sm:text-sm"
              >เสิร์ฟแล้ว</span
            >
            <strong class="text-2xl font-semibold tabular-nums text-current">{{
              servedCount()
            }}</strong>
            <small class="hidden text-xs font-normal text-current sm:block"
              >รายการเสร็จสิ้น</small
            >
          </button>
        </div>

        <div class="my-4 flex flex-wrap items-center gap-3">
          <h2 class="mr-auto text-lg font-semibold">รายการออเดอร์</h2>
          <label hlmLabel for="order-filter">กรองสถานะ</label>
          <hlm-native-select
            class="block w-full sm:w-64"
            selectId="order-filter"
            [value]="filter()"
            (valueChange)="setQueueFilter($event ?? 'active')"
          >
            <option value="active">ออเดอร์ที่ยังไม่เสร็จ</option>
            <option value="in_progress">รับแล้ว / กำลังเตรียม</option>
            <option value="all">ทั้งหมดที่โหลด</option>
            <option value="submitted">รอรับ</option>
            <option value="accepted">รับแล้ว</option>
            <option value="preparing">กำลังเตรียม</option>
            <option value="served">เสิร์ฟแล้ว</option>
            <option value="cancelled">ยกเลิก</option>
          </hlm-native-select>
        </div>
        <p
          class="my-3 text-sm leading-relaxed text-muted-foreground"
          role="status"
        >
          กำลังแสดง {{ orders().length }} ออเดอร์ที่โหลด ·
          สรุปด้านบนคำนวณจากรายการที่โหลดเท่านั้น
        </p>
        <div
          class="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="ช่องทางสั่งอาหาร"
        >
          @for (channel of channels; track channel.id) {
            <button
              hlmBtn
              type="button"
              class="min-h-11"
              [variant]="orderChannel() === channel.id ? 'default' : 'outline'"
              [attr.aria-pressed]="orderChannel() === channel.id"
              (click)="orderChannel.set(channel.id)"
            >
              {{ channel.label }}
            </button>
          }
        </div>
        @if (visibleOrders().length === 0) {
          <p
            class="my-4 rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm leading-relaxed text-muted-foreground"
            role="status"
          >
            {{
              refreshing()
                ? "กำลังเรียกข้อมูลออเดอร์..."
                : "ไม่มีออเดอร์ในสถานะนี้"
            }}
          </p>
        } @else {
          <div class="grid min-w-0 grid-cols-1 gap-3">
            @for (order of visibleOrders(); track order.orderId) {
              <article
                hlmCard
                size="sm"
                class="order-card min-w-0 gap-3 rounded-xl p-4 sm:p-5"
                [class.ring-2]="order.status === 'submitted'"
                [class.ring-primary-line]="order.status === 'submitted'"
                [attr.aria-label]="'ออเดอร์ ' + number(order.displayNumber)"
              >
                <div
                  class="flex min-w-0 flex-wrap items-start justify-between gap-3"
                >
                  <div class="min-w-0">
                    <span
                      class="text-lg font-semibold tracking-tight tabular-nums"
                      >{{ number(order.displayNumber) }}</span
                    >
                    <p
                      class="mt-1 text-sm leading-relaxed text-muted-foreground"
                    >
                      {{
                        order.tableId
                          ? "โต๊ะ " + order.tableId.slice(0, 8)
                          : "เคาน์เตอร์ / Quick"
                      }}
                      ·
                      {{ time(order.createdAt) }}
                    </p>
                  </div>
                  <span
                    hlmBadge
                    class="shrink-0 self-start"
                    [variant]="
                      order.status === 'cancelled' ? 'destructive' : 'outline'
                    "
                    [class.bg-incoming]="order.status === 'submitted'"
                    [class.text-incoming-foreground]="
                      order.status === 'submitted'
                    "
                    [class.bg-accepted]="order.status === 'accepted'"
                    [class.text-accepted-foreground]="
                      order.status === 'accepted'
                    "
                    [class.bg-preparing]="order.status === 'preparing'"
                    [class.text-preparing-foreground]="
                      order.status === 'preparing'
                    "
                    [class.bg-served]="order.status === 'served'"
                    [class.text-served-foreground]="order.status === 'served'"
                  >
                    {{ statusLabel[order.status] }}
                  </span>
                </div>
                <div
                  class="grid min-w-0 gap-2 rounded-xl bg-muted/40 p-3 sm:grid-cols-2"
                  aria-label="ข้อมูลผู้สั่งและสถานที่ส่ง"
                >
                  <div class="min-w-0 space-y-1">
                    <span class="block text-xs text-muted-foreground"
                      >ผู้สั่ง</span
                    >
                    <strong class="block break-words text-sm font-medium">{{
                      order.orderedBy || "ไม่ระบุ (ออเดอร์เดิม)"
                    }}</strong>
                  </div>
                  <div class="min-w-0 space-y-1">
                    <span class="block text-xs text-muted-foreground"
                      >ส่งที่</span
                    >
                    <strong class="block break-words text-sm font-medium">{{
                      order.deliverTo || "ไม่ระบุ (ออเดอร์เดิม)"
                    }}</strong>
                  </div>
                </div>
                <ul
                  class="m-0 list-none divide-y divide-border border-y border-border p-0"
                >
                  @for (item of order.items; track $index) {
                    <li class="py-3">
                      <div
                        class="flex min-w-0 flex-wrap items-start justify-between gap-3 text-sm leading-relaxed"
                      >
                        <span class="min-w-0 flex-1 break-words text-foreground"
                          ><strong class="mr-1 font-semibold"
                            >{{ item.quantity }}×</strong
                          >
                          {{ item.productName }}</span
                        >
                        <span
                          class="shrink-0 whitespace-nowrap font-semibold tabular-nums"
                          >{{ money(item.lineTotalSatang) }} ฿</span
                        >
                      </div>
                      @if (item.options.length) {
                        <p
                          class="mt-1 text-sm leading-relaxed text-muted-foreground"
                        >
                          @for (opt of item.options; track $index) {
                            {{ opt.name }}{{ !$last ? " · " : "" }}
                          }
                        </p>
                      }
                      @if (item.note) {
                        <p
                          class="mt-2 rounded-lg bg-muted p-2 text-sm leading-relaxed text-brand-foreground"
                        >
                          <strong>หมายเหตุ:</strong> {{ item.note }}
                        </p>
                      }
                    </li>
                  }
                </ul>
                <div
                  class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"
                >
                  <span class="text-sm text-muted-foreground">
                    ยอดออเดอร์ ·
                    {{ paymentStatusLabel[order.paymentState] }}
                  </span>
                  <strong
                    class="whitespace-nowrap text-lg font-semibold tabular-nums"
                    >{{ money(order.amountSatang) }} ฿</strong
                  >
                </div>
                @if (order.tableId && order.visitId && mayCloseBill()) {
                  <button
                    hlmBtn
                    variant="outline"
                    type="button"
                    class="min-h-11"
                    [disabled]="billBusy() || !connected()"
                    (click)="showBill(order)"
                  >
                    ดูบิลโต๊ะ
                  </button>
                  @if (
                    bill()?.visitId === order.visitId &&
                    billOrderId() === order.orderId
                  ) {
                    <div
                      class="space-y-3 rounded-xl border border-border bg-muted/30 p-3"
                    >
                      <p class="font-semibold">
                        {{
                          bill()!.status === "open"
                            ? "บิลเปิดอยู่"
                            : "ปิดบิลแล้ว"
                        }}
                      </p>
                      <p class="text-sm">
                        {{ bill()!.orderCount }} ออเดอร์ · ยอดรวม
                        {{ money(bill()!.operationalTotalSatang) }} ฿
                      </p>
                      <p class="text-xs text-muted-foreground">
                        ยอดเพื่อการดำเนินงาน ไม่ใช่ยอดรับชำระเงิน
                      </p>
                      @if (bill()!.status === "open") {
                        <button
                          hlmBtn
                          type="button"
                          variant="destructive"
                          class="min-h-11"
                          [disabled]="billBusy() || !connected()"
                          (click)="closeSelectedBill()"
                        >
                          ปิดบิลและจบรอบโต๊ะ
                        </button>
                      }
                    </div>
                  }
                }
                @if (!order.tableId && order.status === "accepted") {
                  <p class="text-sm text-muted-foreground">
                    ลูกค้ายังสั่งเพิ่มได้จนกดเริ่มเตรียม
                  </p>
                }
                <div
                  class="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap"
                >
                  @for (
                    action of actions(order.status);
                    track action.nextStatus
                  ) {
                    <button
                      hlmBtn
                      type="button"
                      [variant]="action.destructive ? 'destructive' : 'default'"
                      class="min-h-11"
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
                  @if (
                    (store()?.role === "owner" ||
                      store()?.role === "manager") &&
                    (order.status === "preparing" || order.status === "served")
                  ) {
                    <a
                      hlmBtn
                      variant="outline"
                      class="min-h-11"
                      [routerLink]="[
                        '/inventory',
                        store()!.tenantId,
                        store()!.storeId,
                        'exception-returns',
                        order.orderId,
                      ]"
                    >
                      คืนสต็อกกรณีพิเศษ
                    </a>
                  }
                  <button
                    hlmBtn
                    type="button"
                    variant="outline"
                    class="min-h-11"
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
                    class="mt-3 border-t border-border pt-3"
                    aria-label="ประวัติการเปลี่ยนสถานะ"
                  >
                    <h3 class="font-semibold">ประวัติออเดอร์</h3>
                    <ol
                      class="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed"
                    >
                      @for (entry of history()!.events; track $index) {
                        <li>
                          <strong class="font-semibold">{{
                            statusLabel[entry.status]
                          }}</strong>
                          <span class="ml-2 text-muted-foreground">{{
                            time(entry.occurredAt)
                          }}</span>
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
          <div class="my-5 grid justify-items-center gap-3 text-center">
            <button
              hlmBtn
              variant="outline"
              class="min-h-11"
              type="button"
              (click)="loadOlderOrders()"
              [disabled]="
                refreshing() || !connected() || loadedPages() >= maxInboxPages
              "
            >
              {{
                loadedPages() >= maxInboxPages
                  ? "ถึงขีดจำกัดโหลดต่อรอบ"
                  : "โหลดออเดอร์เก่าเพิ่มอีก 50 รายการ"
              }}
            </button>
            @if (loadedPages() >= maxInboxPages) {
              <p
                class="text-sm leading-relaxed text-muted-foreground"
                role="status"
              >
                ยังมีรายการเก่ากว่านี้
                ต้องใช้การค้นหาและรายงานย้อนหลังในระยะถัดไป
              </p>
            }
          </div>
        }

        <details
          class="mt-5 overflow-hidden rounded-xl border border-border bg-card"
        >
          <summary
            class="flex min-h-12 cursor-pointer flex-wrap items-center justify-between gap-3 p-4 font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span>เหตุการณ์ล่าสุด</span>
            <span class="text-sm font-normal text-muted-foreground"
              >{{ events().length }} เหตุการณ์ · ดูบันทึก</span
            >
          </summary>
          <section
            class="border-t border-border p-4"
            aria-labelledby="events-title"
          >
            <div class="my-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id="events-title" class="text-lg font-semibold">
                เหตุการณ์ล่าสุด
              </h2>
              <span class="text-sm text-muted-foreground"
                >มาจาก Outbox ที่บันทึกในฐานข้อมูล</span
              >
            </div>
            @if (events().length === 0) {
              <p
                class="my-4 rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm leading-relaxed text-muted-foreground"
              >
                ยังไม่มีเหตุการณ์ใหม่ที่รับจาก Outbox ในหน้าจอนี้
              </p>
            } @else {
              <ol
                class="m-0 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0"
              >
                @for (event of events(); track event.eventId) {
                  <li class="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <span class="font-semibold">{{
                      event.eventType === "order.items.added"
                        ? "เพิ่มรายการ"
                        : statusLabel[event.status]
                    }}</span>
                    <span>ออเดอร์ {{ eventNumber(event.orderId) }}</span>
                    <time
                      class="ml-auto text-sm tabular-nums text-muted-foreground"
                      >{{ time(event.occurredAt) }}</time
                    >
                  </li>
                }
              </ol>
            }
          </section>
        </details>
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
  private stream?: EventSource;
  private streamRefresh?: ReturnType<typeof setTimeout>;
  private refreshPending = false;
  private disposed = false;
  private inFlight = false;
  private tenantId = "";
  private storeId = "";

  readonly store = signal<MerchantStore | null>(null);
  readonly orders = signal<MerchantOrder[]>([]);
  readonly number = formatOrderNumber;

  eventNumber(orderId: string): string {
    const order = this.orders().find((entry) => entry.orderId === orderId);
    return formatOrderNumber(order?.displayNumber);
  }
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
  readonly streamState = signal<
    "connecting" | "streaming" | "polling" | "paused" | "blocked"
  >("polling");
  readonly filter = signal("active");
  readonly channels = [
    { id: "all", label: "ทุกช่องทาง" },
    { id: "table", label: "โต๊ะ" },
    { id: "quick", label: "เคาน์เตอร์" },
  ];
  readonly orderChannel = signal("all");
  readonly bill = signal<OperationalBill | null>(null);
  readonly billOrderId = signal<string | null>(null);
  readonly billBusy = signal(false);
  readonly mayCloseBill = computed(() => {
    const role = this.store()?.role;
    return role === "owner" || role === "manager" || role === "cashier";
  });

  setQueueFilter(value: string): void {
    this.filter.set(value);
  }
  readonly history = signal<OrderHistory | null>(null);
  readonly selectedHistoryId = signal<string | null>(null);
  readonly historyLoadingId = signal<string | null>(null);
  readonly statusLabel = STATUS_LABEL;
  readonly roleLabel = ROLE_LABEL;
  readonly paymentStatusLabel = PAYMENT_STATUS_LABEL;
  readonly money = formatSatang;

  readonly visibleOrders = computed(() => {
    const filter = this.filter();
    return this.orders()
      .filter((order) =>
        this.orderChannel() === "table"
          ? !!order.tableId
          : this.orderChannel() === "quick"
            ? !order.tableId
            : true,
      )
      .filter((order) =>
        filter === "in_progress"
          ? order.status === "accepted" || order.status === "preparing"
          : filter === "all"
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
      if (this.document.visibilityState !== "visible" || !this.connected()) {
        return;
      }
      // SSE is an advisory wake signal, not a durable acknowledgement.
      // Periodic reconciliation still runs when the stream appears healthy.
      const synced = this.lastSynced();
      if (
        this.streamState() !== "streaming" ||
        !synced ||
        Date.now() - synced.getTime() >= SSE_RECONCILE_MS
      ) {
        void this.refresh();
      }
    }, POLL_MS);
    void this.initialize();
  }

  ngOnDestroy(): void {
    this.disposed = true;
    if (this.interval) clearInterval(this.interval);
    if (this.streamRefresh) clearTimeout(this.streamRefresh);
    this.closeStream();
    this.win?.removeEventListener("online", this.resume);
    this.win?.removeEventListener("offline", this.goOffline);
    this.win?.removeEventListener("focus", this.resume);
    this.document.removeEventListener("visibilitychange", this.resume);
  }

  private readonly goOffline = () => {
    this.connected.set(false);
    this.closeStream();
    this.streamState.set("polling");
    this.warning.set("การเชื่อมต่อขาด · รายการบนจออาจไม่ใช่สถานะล่าสุด");
  };

  private readonly resume = () => {
    this.connected.set(this.win?.navigator.onLine ?? true);
    if (this.document.visibilityState !== "visible") {
      this.closeStream();
      if (this.streamState() !== "blocked") this.streamState.set("paused");
      return;
    }
    if (this.connected() && this.streamState() !== "blocked") {
      this.openStream();
      this.queueStreamRefresh();
    }
  };

  private closeStream(): void {
    this.stream?.close();
    this.stream = undefined;
  }

  private queueStreamRefresh(): void {
    if (this.disposed || this.streamState() === "blocked") return;
    this.refreshPending = true;
    if (this.streamRefresh) return;
    this.streamRefresh = setTimeout(() => {
      this.streamRefresh = undefined;
      if (this.inFlight) return; // retry once the in-flight refresh finishes
      if (!this.refreshPending) return;
      this.refreshPending = false;
      void this.refresh();
    }, SSE_EVENT_DEBOUNCE_MS);
  }

  private openStream(): void {
    if (
      this.disposed ||
      this.stream ||
      !this.store() ||
      !this.connected() ||
      this.streamState() === "blocked" ||
      this.document.visibilityState !== "visible"
    ) {
      return;
    }
    if (typeof EventSource === "undefined") {
      this.streamState.set("polling");
      return;
    }
    const source = new EventSource(
      this.api.notificationStreamUrl(this.tenantId, this.storeId),
      { withCredentials: true },
    );
    this.stream = source;
    this.streamState.set("connecting");

    source.addEventListener("open", () => {
      if (this.disposed || this.stream !== source) return;
      this.streamState.set("streaming");
      // Always reconcile from authoritative Inbox + saved Outbox ack on
      // (re)connect. SSE Last-Event-ID is never a financial/order authority.
      this.queueStreamRefresh();
    });
    source.addEventListener("order-event", () => {
      if (this.disposed || this.stream !== source) return;
      // Advisory only. Do not trust SSE payload as a new Order or ack it.
      this.queueStreamRefresh();
    });
    source.addEventListener("access-revoked", () => {
      if (this.disposed || this.stream !== source) return;
      this.blockAccess();
    });
    source.addEventListener("stream-error", () => {
      if (this.disposed || this.stream !== source) return;
      this.streamState.set("polling");
      this.queueStreamRefresh();
    });
    source.onerror = () => {
      if (this.disposed || this.stream !== source) return;
      // EventSource will retry automatically; 10s polling still recovers.
      this.streamState.set("polling");
      this.queueStreamRefresh();
    };
  }

  private blockAccess(): void {
    this.closeStream();
    this.streamState.set("blocked");
    this.orders.set([]);
    this.events.set([]);
    this.bill.set(null);
    this.billOrderId.set(null);
    this.store.set(null);
    this.error.set("สิทธิ์ร้านหรือเซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
  }

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
      this.openStream();
      await this.refresh();
    } catch (error) {
      if (!this.disposed) this.error.set(failureText(error));
    }
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

  // Use keyset pages only for explicitly requested visual history. Outbox
  // recovery instead resolves exact event Order IDs through a scoped batch
  // lookup, avoiding a historical page-count ceiling and database scans.
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
      missingOrderIds(requiredOrderIds, orders).length === 0;
    while (
      !this.disposed &&
      response.hasMore &&
      response.nextCursor &&
      pages < MAX_INBOX_PAGES &&
      pages < minimumPages
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
    const missing = missingOrderIds(requiredOrderIds, orders);
    if (!this.disposed && missing.length > 0) {
      // Notification pages contain <=50 events, so this stays bounded.
      // Unknown or foreign-store IDs are omitted by PostgreSQL; never ack
      // unless *every* referenced Order is in the authoritative result.
      const resolved = await this.api.lookupOrders(
        this.tenantId,
        this.storeId,
        missing,
      );
      orders = appendOrderPage(orders, resolved.orders);
    }
    return { orders, hasMore: response.hasMore, pages, covered: covered() };
  }

  async loadOlderOrders(): Promise<void> {
    if (
      this.refreshing() ||
      !this.hasMoreOrders() ||
      this.loadedPages() >= MAX_INBOX_PAGES
    )
      return;
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
        new Set<string>(),
        this.loadedPages(),
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
        // Outbox IDs are commit-ordered. Refresh selected history and
        // resolve remaining referenced Order IDs directly with scoped SQL.
        snapshot = await this.authoritativePages(
          new Set(batch.events.map((event) => event.orderId)),
          this.loadedPages(),
        );
        if (this.disposed) return;
        this.orders.set(snapshot.orders);
        this.hasMoreOrders.set(snapshot.hasMore);
        this.loadedPages.update((count) => Math.max(count, snapshot.pages));
        if (
          !snapshot.covered ||
          !hasEventCoverage(batch.events, snapshot.orders)
        ) {
          this.warning.set(
            "ไม่พบออเดอร์ที่เหตุการณ์อ้างถึงในร้านนี้ จึงยังไม่ยืนยันรับทราบ กรุณาตรวจสอบข้อมูล",
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
      if (!this.disposed) {
        if (
          error instanceof HttpErrorResponse &&
          [401, 403, 404].includes(error.status)
        ) {
          this.blockAccess();
        } else {
          this.error.set(failureText(error));
        }
      }
    } finally {
      this.inFlight = false;
      if (!this.disposed) {
        this.refreshing.set(false);
        if (this.refreshPending) this.queueStreamRefresh();
      }
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

  async showBill(order: MerchantOrder): Promise<void> {
    if (!order.visitId || !this.mayCloseBill() || this.billBusy()) return;
    this.billBusy.set(true);
    this.bill.set(null);
    this.billOrderId.set(order.orderId);
    this.error.set("");
    try {
      const result = await this.api.billByVisit(
        this.tenantId,
        this.storeId,
        order.visitId,
      );
      if (!this.disposed && this.mayCloseBill()) this.bill.set(result);
    } catch (error) {
      if (!this.disposed) this.error.set(failureText(error));
    } finally {
      this.billBusy.set(false);
    }
  }

  async closeSelectedBill(): Promise<void> {
    const bill = this.bill();
    if (
      !bill ||
      bill.status !== "open" ||
      !this.mayCloseBill() ||
      this.billBusy() ||
      !this.connected()
    )
      return;
    if (
      !this.win?.confirm(
        "ปิดบิลและจบรอบโต๊ะนี้? ลูกค้าเดิมจะสั่งเพิ่มไม่ได้ การปิดบิลไม่ใช่การยืนยันรับเงิน",
      )
    )
      return;
    this.billBusy.set(true);
    this.error.set("");
    try {
      await this.api.closeBill(this.tenantId, this.storeId, bill.billId);
      const updated = await this.api.billByVisit(
        this.tenantId,
        this.storeId,
        bill.visitId,
      );
      if (!this.disposed && this.mayCloseBill()) this.bill.set(updated);
    } catch (error) {
      if (!this.disposed) this.error.set(failureText(error));
      this.bill.set(null);
    } finally {
      this.billBusy.set(false);
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
