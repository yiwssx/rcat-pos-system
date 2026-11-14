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
import { RouterLink } from "@angular/router";
import {
  formatSatang,
  GuestOrderHistory,
  GuestOrderStatus,
  GuestPaymentRequest,
  ORDER_STATUS_LABEL,
} from "./guest-order.domain";
import { GuestOrderApi, GuestOrderSession } from "./guest-order.api";

const TRACK_INTERVAL_MS = 15_000;

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrls: ["./guest-order.css"],
  template: `
    <section
      class="guest-shell guest-tracking"
      aria-labelledby="tracking-title"
    >
      <a routerLink="/order" class="guest-track-link">← กลับไปหน้าเมนู</a>
      <span class="eyebrow">ORDER TRACKING</span>
      <h1 id="tracking-title">ติดตามคำสั่งซื้อ</h1>
      <p class="guest-context">
        แสดงสถานะจากร้านค้าโดยตรง · การส่งออเดอร์สำเร็จไม่ใช่การชำระเงินสำเร็จ
      </p>
      @if (!online()) {
        <p class="guest-warning" role="status">
          ออฟไลน์ · สถานะออเดอร์ล่าสุดอาจเปลี่ยนแล้ว
          ระบบจะตรวจสอบใหม่เมื่อเชื่อมต่ออินเทอร์เน็ต
        </p>
      }

      @if (!session.tracking()) {
        <div class="guest-status" role="status">
          ไม่พบคำสั่งซื้อที่ติดตามได้ในแท็บนี้ โปรดเปิดหน้าเมนูจาก QR
          และส่งคำสั่งซื้อก่อน
        </div>
      } @else {
        <div class="guest-track-card">
          <p class="guest-track-id">
            หมายเลขออเดอร์ #{{ session.tracking()!.orderId.slice(0, 8) }}
          </p>
          @if (status()) {
            <span
              class="guest-order-state"
              [class.is-finished]="status()!.status === 'served'"
            >
              {{ statusLabel[status()!.status] }}
            </span>
            <h2 class="guest-amount">{{ money(status()!.amountSatang) }} ฿</h2>
            <p class="guest-context">
              ยอดที่ร้านบันทึกไว้ · ยังไม่ใช่ยอดชำระแล้ว
            </p>
            <p class="guest-track-time">
              อัปเดตล่าสุด {{ formatDate(status()!.updatedAt) }}
            </p>
          } @else {
            <p role="status">กำลังโหลดสถานะออเดอร์...</p>
          }
          @if (error()) {
            <div class="guest-error" role="alert">{{ error() }}</div>
          }
          @if (status()?.status === "cancelled") {
            <p class="guest-payment-alert" role="note">
              ออเดอร์ถูกยกเลิกแล้ว · ไม่สามารถสร้าง QR ชำระเงินใหม่ได้
            </p>
          } @else if (payment()) {
            <section class="guest-payment-card" aria-labelledby="payment-title">
              <h2 id="payment-title">ชำระเงินด้วย PromptPay</h2>
              <p class="guest-context">
                ยอดที่ระบบระบุ {{ money(payment()!.amountSatang) }} ฿
                · สามารถชำระภายหลังได้
              </p>
              <img
                class="guest-payment-qr"
                [src]="payment()!.qrImageDataUrl"
                alt="QR PromptPay ของออเดอร์นี้"
                width="240"
                height="240"
              />
              <p class="guest-context">
                ใช้แอปธนาคารสแกน หรือบันทึกรูป QR
                เพื่อนำเข้าแอปธนาคารบนโทรศัพท์เครื่องเดียวกัน
              </p>
              <div class="guest-track-actions">
                <button type="button" (click)="savePaymentQr()">
                  บันทึก QR
                </button>
                <button
                  type="button"
                  class="guest-subtle"
                  [disabled]="paymentLoading() || !online()"
                  (click)="loadPayment(true)"
                >
                  ตรวจสอบ QR อีกครั้ง
                </button>
              </div>
              <p class="guest-payment-alert" role="note">
                QR ไม่ใช่หลักฐานว่าเงินเข้าแล้ว
                การส่งสลิปและการยืนยันโดยร้านยังอยู่ระหว่างพัฒนา
              </p>
            </section>
          } @else if (paymentLoading()) {
            <p class="guest-status" role="status">
              กำลังตรวจสอบช่องทางชำระเงิน...
            </p>
          } @else if (paymentChecked()) {
            <div class="guest-payment-alert" role="note">
              ยังไม่เปิดรับการชำระเงินในระบบนี้ (Payment: not_requested)
              <button
                type="button"
                class="guest-subtle"
                [disabled]="!online()"
                (click)="loadPayment(true)"
              >
                ตรวจสอบช่องทางอีกครั้ง
              </button>
            </div>
          }
          @if (paymentError()) {
            <p class="guest-warning" role="status">{{ paymentError() }}</p>
          }
          @if (history()?.events?.length) {
            <h2>ประวัติสถานะ</h2>
            <ol class="guest-timeline">
              @for (event of history()!.events; track $index) {
                <li>
                  <strong>{{ statusLabel[event.status] }}</strong>
                  <time>{{ formatDate(event.occurredAt) }}</time>
                </li>
              }
            </ol>
          }
          <div class="guest-track-actions">
            <button
              type="button"
              [disabled]="loading() || !online()"
              (click)="refresh()"
            >
              {{ loading() ? "กำลังโหลด..." : "ตรวจสถานะล่าสุด" }}
            </button>
            <button type="button" class="guest-subtle" (click)="clear()">
              ล้างข้อมูลติดตามจากแท็บนี้
            </button>
          </div>
          <p class="guest-privacy">
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
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private interval?: ReturnType<typeof setInterval>;
  private destroyed = false;
  private paymentForOrder: string | null = null;
  readonly payment = signal<
    Extract<GuestPaymentRequest, { available: true }> | null
  >(null);
  readonly paymentChecked = signal(false);
  readonly paymentLoading = signal(false);
  readonly paymentError = signal("");
  readonly status = signal<GuestOrderStatus | null>(null);
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
      this.status.set(latest);
      if (latest.status === "cancelled") {
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
      if (this.destroyed || this.session.tracking()?.orderId !== tracked.orderId) {
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

  savePaymentQr(): void {
    const tracked = this.session.tracking();
    const payment = this.payment();
    if (!tracked || !payment) return;
    const anchor = this.document.createElement("a");
    anchor.href = payment.qrImageDataUrl;
    anchor.download = `rcat-pos-order-${tracked.orderId.slice(0, 8)}-qr.png`;
    anchor.click();
  }

  clear(): void {
    this.payment.set(null);
    this.paymentChecked.set(false);
    this.paymentForOrder = null;
    this.paymentError.set("");
    this.session.clearTracking();
    this.status.set(null);
    this.history.set(null);
    this.error.set("");
  }
}
