import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import {
  formatSatang,
  formatOrderNumber,
  GuestOrderHistory,
  GuestOrderStatus,
  GuestPayable,
  ORDER_STATUS_LABEL,
} from "./guest-order.domain";
import { GuestOrderApi, GuestOrderSession } from "./guest-order.api";

const TRACK_INTERVAL_MS = 15_000;

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HlmButton, HlmInput],
  template: `
    <section
      class="guest-shell guest-tracking mx-auto w-full max-w-3xl min-w-0 space-y-4 px-4 pb-8 pt-4 sm:px-6"
      aria-labelledby="tracking-title"
    >
      <a
        routerLink="/order"
        [queryParams]="counterReturn"
        class="guest-track-link inline-flex min-h-11 items-center rounded-xl bg-secondary px-3 text-sm font-semibold text-secondary-foreground no-underline focus-visible:outline-2 focus-visible:outline-ring"
        >← กลับไปหน้าเมนู</a
      >
      <span
        class="eyebrow block text-xs font-semibold tracking-wide text-brand-foreground"
        >ORDER TRACKING</span
      >
      <h1
        class="m-0 max-w-none text-2xl font-semibold leading-tight sm:text-3xl"
        id="tracking-title"
      >
        ติดตามคำสั่งซื้อ
      </h1>
      <p
        class="guest-context break-words text-sm leading-6 text-muted-foreground"
      >
        ติดตามความคืบหน้าของอาหารและตรวจสอบการชำระเงินได้ที่นี่
      </p>
      @if (!online()) {
        <p
          class="guest-warning rounded-xl bg-preparing p-3 text-sm leading-6 text-preparing-foreground"
          role="status"
        >
          ออฟไลน์ · สถานะออเดอร์ล่าสุดอาจเปลี่ยนแล้ว
          ระบบจะตรวจสอบใหม่เมื่อเชื่อมต่ออินเทอร์เน็ต
        </p>
      }

      @if (!session.tracking()) {
        <div
          class="guest-status rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"
          role="status"
        >
          ไม่พบคำสั่งซื้อที่ติดตามได้ในแท็บนี้ โปรดเปิดหน้าเมนูจาก QR
          และส่งคำสั่งซื้อก่อน
        </div>
      } @else {
        <div
          class="guest-track-card min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-6"
        >
          <p class="guest-track-id m-0 text-lg font-semibold tabular-nums">
            หมายเลขออเดอร์ {{ number(status()?.displayNumber) }}
          </p>
          @if (status()) {
            <span
              class="guest-order-state inline-flex rounded-lg px-3 py-2 text-sm font-semibold"
              [class.is-finished]="status()!.status === 'served'"
              [class.bg-incoming]="status()!.status === 'submitted'"
              [class.text-incoming-foreground]="
                status()!.status === 'submitted'
              "
              [class.bg-accepted]="status()!.status === 'accepted'"
              [class.text-accepted-foreground]="status()!.status === 'accepted'"
              [class.bg-preparing]="status()!.status === 'preparing'"
              [class.text-preparing-foreground]="
                status()!.status === 'preparing'
              "
              [class.bg-served]="status()!.status === 'served'"
              [class.text-served-foreground]="status()!.status === 'served'"
              [class.text-destructive]="status()!.status === 'cancelled'"
            >
              {{ statusLabel[status()!.status] }}
            </span>
            <h2
              class="guest-amount m-0 text-2xl font-semibold tabular-nums text-primary"
            >
              {{ money(status()!.amountSatang) }} ฿
            </h2>
            <p
              class="guest-context break-words text-sm leading-6 text-muted-foreground"
            >
              ยอดรวมของออเดอร์
            </p>
            <p class="guest-track-time text-sm text-muted-foreground">
              อัปเดตล่าสุด {{ formatDate(status()!.updatedAt) }}
            </p>
          } @else {
            <p role="status">กำลังโหลดสถานะออเดอร์...</p>
          }
          @if (error()) {
            <div
              class="guest-error rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive"
              role="alert"
            >
              {{ error() }}
            </div>
          }
          @if (status()?.status === "cancelled") {
            <p
              class="guest-payment-alert space-y-2 rounded-xl bg-muted p-3 text-sm leading-6 text-foreground"
              role="note"
            >
              ออเดอร์ถูกยกเลิกแล้ว · ไม่สามารถสร้าง QR ชำระเงินใหม่ได้
            </p>
          } @else if (status()?.paymentState === "manual_confirmed") {
            <p
              class="guest-payment-alert space-y-2 rounded-xl bg-muted p-3 text-sm leading-6 text-foreground"
              role="status"
            >
              ร้านยืนยันว่าได้รับเงินแล้ว โดยพนักงานตรวจสอบรายการเงินเข้าจริง
            </p>
          } @else if (status()?.paymentState === "slip_submitted") {
            <p
              class="guest-payment-alert space-y-2 rounded-xl bg-muted p-3 text-sm leading-6 text-foreground"
              role="status"
            >
              ส่งสลิปแล้ว · รอร้านตรวจสอบยอดเงินเข้าจริง
            </p>
          } @else if (payment()) {
            <div
              class="guest-payment-card min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4"
            >
              <h2 class="m-0 text-lg font-semibold leading-snug">
                ชำระเงินด้วยพร้อมเพย์
              </h2>
              <p
                class="guest-context break-words text-sm leading-6 text-muted-foreground"
              >
                ยอดชำระ {{ money(payment()!.amountSatang) }} ฿ ·
                จ่ายตอนนี้หรือภายหลังได้
              </p>
              <img
                class="guest-payment-qr mx-auto block h-auto max-w-full rounded-xl border border-border bg-white p-2 object-contain"
                [src]="payment()!.qrImageDataUrl"
                alt="QR PromptPay ของออเดอร์นี้"
                width="240"
                height="240"
              />
              <p
                class="guest-context break-words text-sm leading-6 text-muted-foreground"
              >
                ใช้แอปธนาคารสแกน หรือบันทึกรูป QR
                เพื่อนำเข้าแอปธนาคารบนโทรศัพท์เครื่องเดียวกัน
              </p>
              <div class="guest-track-actions flex flex-wrap gap-2">
                <button
                  hlmBtn
                  variant="default"
                  class="min-h-11"
                  type="button"
                  (click)="savePaymentQr()"
                >
                  บันทึกรูป QR เพื่อชำระเงิน
                </button>
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="guest-subtle min-h-11"
                  [disabled]="paymentLoading() || !online()"
                  (click)="loadPayment(true)"
                >
                  ตรวจสอบ QR อีกครั้ง
                </button>
              </div>
              <p
                class="guest-payment-alert space-y-2 rounded-xl bg-muted p-3 text-sm leading-6 text-foreground"
                role="note"
              >
                หลังโอนเงิน โปรดแนบสลิปและรอร้านตรวจสอบยอดเงินเข้าจริง
                การแนบสลิปไม่ใช่การยืนยันว่าร้านได้รับเงินแล้ว
              </p>
              <label for="payment-slip-file">แนบสลิปการโอน</label>
              <input
                hlmInput
                class="min-h-11 w-full"
                id="payment-slip-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                [disabled]="slipLoading() || !online()"
                (change)="onSlipSelected($event)"
              />
              <p
                class="guest-context break-words text-sm leading-6 text-muted-foreground"
              >
                รองรับรูป PNG, JPG, WebP · ระบบแปลงและลดขนาดก่อนส่ง
              </p>
              @if (slipLoading()) {
                <p role="status">กำลังส่งหลักฐานการชำระเงิน...</p>
              }
              @if (slipMessage()) {
                <p role="status">{{ slipMessage() }}</p>
              }
              @if (slipError()) {
                <p
                  class="guest-warning rounded-xl bg-preparing p-3 text-sm leading-6 text-preparing-foreground"
                  role="alert"
                >
                  {{ slipError() }}
                </p>
              }
            </div>
          } @else if (paymentLoading()) {
            <p
              class="guest-status rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"
              role="status"
            >
              กำลังตรวจสอบช่องทางชำระเงิน...
            </p>
          } @else if (paymentChecked()) {
            <div
              class="guest-payment-alert space-y-2 rounded-xl bg-muted p-3 text-sm leading-6 text-foreground"
              role="note"
            >
              ร้านยังไม่เปิดรับชำระเงินผ่านระบบนี้
              กรุณาสอบถามวิธีชำระเงินจากร้าน
              <button
                hlmBtn
                variant="outline"
                type="button"
                class="guest-subtle min-h-11"
                [disabled]="!online()"
                (click)="loadPayment(true)"
              >
                ตรวจสอบช่องทางอีกครั้ง
              </button>
            </div>
          }
          @if (paymentError()) {
            <p
              class="guest-warning rounded-xl bg-preparing p-3 text-sm leading-6 text-preparing-foreground"
              role="status"
            >
              {{ paymentError() }}
            </p>
          }
          @if (history()?.events?.length) {
            <h2 class="m-0 text-lg font-semibold leading-snug">ประวัติสถานะ</h2>
            <ol
              class="guest-timeline m-0 list-none space-y-3 border-l-2 border-border pl-4"
            >
              @for (event of history()!.events; track $index) {
                <li
                  class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted p-3 text-sm"
                >
                  <strong>{{ statusLabel[event.status] }}</strong>
                  <time class="text-muted-foreground">{{
                    formatDate(event.occurredAt)
                  }}</time>
                </li>
              }
            </ol>
          }
          <div class="guest-track-actions flex flex-wrap gap-2">
            <button
              hlmBtn
              variant="default"
              class="min-h-11"
              type="button"
              [disabled]="loading() || !online()"
              (click)="refresh()"
            >
              {{ loading() ? "กำลังโหลด..." : "ตรวจสถานะล่าสุด" }}
            </button>
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="guest-subtle min-h-11"
              (click)="clear()"
            >
              ล้างข้อมูลติดตามจากแท็บนี้
            </button>
          </div>
          <p class="guest-privacy text-sm leading-6 text-muted-foreground">
            เก็บรหัสติดตามไว้ในแท็บนี้ชั่วคราวเท่านั้น ไม่ส่งผ่าน URL
            เมื่อปิดแท็บหรือหมดระยะเวลาจะไม่สามารถกู้คืนรหัสนี้ได้
          </p>
        </div>
      }
    </section>
  `,
})
export class GuestTrackPage implements OnInit, OnDestroy {
  readonly session = inject(GuestOrderSession);
  private readonly api = inject(GuestOrderApi);
  private readonly route = inject(ActivatedRoute);
  readonly counterReturn = this.publicCounterReturn();

  private publicCounterReturn(): Record<string, string> {
    const query = this.route.snapshot.queryParamMap;
    const tenant = query.get("tenant");
    const store = query.get("store");
    const counter = query.get("counter");
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return query.keys.length === 3 &&
      tenant &&
      store &&
      counter &&
      [tenant, store, counter].every((value) => uuid.test(value))
      ? { tenant, store, counter }
      : {};
  }

  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private interval?: ReturnType<typeof setInterval>;
  private destroyed = false;
  private paymentForOrder: string | null = null;
  readonly payment = signal<GuestPayable | null>(null);
  readonly paymentChecked = signal(false);
  readonly paymentLoading = signal(false);
  readonly paymentError = signal("");
  readonly slipLoading = signal(false);
  readonly slipError = signal("");
  readonly slipMessage = signal("");
  readonly status = signal<GuestOrderStatus | null>(null);
  readonly number = formatOrderNumber;
  readonly history = signal<GuestOrderHistory | null>(null);
  readonly error = signal("");
  readonly loading = signal(false);
  readonly online = signal(true);
  readonly money = formatSatang;
  readonly statusLabel = ORDER_STATUS_LABEL;

  ngOnInit(): void {
    this.session.recoverTracking();
    this.online.set(this.window?.navigator.onLine ?? true);
    this.interval = setInterval(() => {
      if (
        this.document.visibilityState === "visible" &&
        (this.window?.navigator.onLine ?? true)
      )
        void this.refresh();
    }, TRACK_INTERVAL_MS);
    this.window?.addEventListener("focus", this.onResume);
    this.window?.addEventListener("online", this.onResume);
    this.window?.addEventListener("offline", this.onOffline);
    this.document.addEventListener("visibilitychange", this.onResume);
    void this.refresh();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.interval) clearInterval(this.interval);
    this.window?.removeEventListener("focus", this.onResume);
    this.window?.removeEventListener("online", this.onResume);
    this.window?.removeEventListener("offline", this.onOffline);
    this.document.removeEventListener("visibilitychange", this.onResume);
  }

  private readonly onOffline = () => {
    this.online.set(false);
  };

  private readonly onResume = () => {
    this.online.set(this.window?.navigator.onLine ?? true);
    if (this.document.visibilityState === "visible" && this.online()) {
      void this.refresh();
    }
  };

  formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? "—"
      : date.toLocaleString("th-TH", {
          dateStyle: "short",
          timeStyle: "short",
        });
  }

  async refresh(): Promise<void> {
    const tracked = this.session.recoverTracking();
    if (!tracked || this.loading() || this.destroyed) return;
    if (!this.online()) return;
    this.loading.set(true);
    this.error.set("");
    try {
      const latest = await this.api.status(
        tracked.orderId,
        tracked.trackingToken,
      );
      if (this.destroyed) return;
      const previousPaymentState = this.status()?.paymentState;
      this.status.set(latest);
      if (previousPaymentState !== latest.paymentState) {
        this.paymentForOrder = null;
      }
      if (
        latest.status === "cancelled" ||
        latest.paymentState === "slip_submitted" ||
        latest.paymentState === "manual_confirmed"
      ) {
        this.payment.set(null);
        this.paymentChecked.set(true);
      } else {
        void this.loadPayment();
      }
      const timeline = await this.api.history(
        tracked.orderId,
        tracked.trackingToken,
      );
      if (!this.destroyed) this.history.set(timeline);
    } catch (error) {
      if (this.destroyed) return;
      this.error.set(
        error instanceof HttpErrorResponse
          ? error.status === 404
            ? "ออเดอร์นี้ไม่พร้อมให้ติดตามหรือรหัสหมดอายุ"
            : error.status === 0
              ? "เครือข่ายไม่พร้อม กรุณาลองอีกครั้ง"
              : "โหลดสถานะไม่สำเร็จ โปรดลองใหม่"
          : "โหลดสถานะไม่สำเร็จ",
      );
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }

  async loadPayment(force = false): Promise<void> {
    const tracked = this.session.recoverTracking();
    if (
      !tracked ||
      !this.online() ||
      this.destroyed ||
      this.paymentLoading() ||
      this.status()?.status === "cancelled" ||
      (!force && this.paymentForOrder === tracked.orderId)
    ) {
      return;
    }
    this.paymentForOrder = tracked.orderId;
    this.paymentLoading.set(true);
    this.paymentChecked.set(false);
    this.paymentError.set("");
    try {
      const result = await this.api.paymentRequest(
        tracked.orderId,
        tracked.trackingToken,
      );
      if (
        this.destroyed ||
        this.session.tracking()?.orderId !== tracked.orderId
      ) {
        return;
      }
      this.payment.set(result.available ? result : null);
      this.paymentChecked.set(true);
    } catch {
      if (this.destroyed) return;
      this.paymentError.set("ยังตรวจสอบช่องทางชำระเงินไม่ได้ โปรดลองอีกครั้ง");
      this.paymentChecked.set(true);
    } finally {
      if (!this.destroyed) this.paymentLoading.set(false);
    }
  }

  async onSlipSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const source = input.files?.[0];
    const tracked = this.session.recoverTracking();
    if (!source || !tracked || this.slipLoading() || !this.online()) return;
    this.slipLoading.set(true);
    this.slipError.set("");
    this.slipMessage.set("");
    try {
      await this.api.uploadPaymentSlip(
        tracked.orderId,
        tracked.trackingToken,
        source,
      );
      this.slipMessage.set("ส่งหลักฐานแล้ว · รอร้านตรวจสอบยอดเงินเข้า");
      this.payment.set(null);
      this.paymentForOrder = null;
      await this.refresh();
    } catch (error) {
      this.slipError.set(
        error instanceof Error && !("status" in error)
          ? error.message
          : "ส่งสลิปไม่สำเร็จ อาจมีสลิปรอตรวจอยู่แล้ว กรุณาลองใหม่",
      );
    } finally {
      input.value = "";
      this.slipLoading.set(false);
    }
  }

  savePaymentQr(): void {
    const tracked = this.session.tracking();
    const payment = this.payment();
    if (!tracked || !payment) return;
    const anchor = this.document.createElement("a");
    anchor.href = payment.qrImageDataUrl;
    anchor.download = `rcat-pos-order-${this.status()?.displayNumber ?? "order"}-qr.png`;
    anchor.click();
  }

  clear(): void {
    this.payment.set(null);
    this.paymentChecked.set(false);
    this.paymentForOrder = null;
    this.paymentError.set("");
    this.slipError.set("");
    this.slipMessage.set("");
    this.session.clearTracking();
    this.status.set(null);
    this.history.set(null);
    this.error.set("");
  }
}
