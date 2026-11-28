import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
} from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { HlmButton } from "@spartan-ng/helm/button";
import { GuestOrderApi, GuestOrderSession } from "./guest-order.api";
import { parseRecoveryFragment } from "./guest-tracking.domain";

@Component({
  standalone: true,
  imports: [RouterLink, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="guest-shell mx-auto max-w-lg space-y-4 px-4 py-8"
      aria-labelledby="recovery-title"
    >
      <h1 id="recovery-title" class="text-2xl font-semibold">
        ชำระออเดอร์เดิม
      </h1>
      <p class="text-sm leading-6 text-muted-foreground">
        ลิงก์นี้เปิดได้เฉพาะออเดอร์ที่ร้านออกให้ ไม่สร้างออเดอร์ใหม่
        หากโอนเงินแล้ว อย่าโอนซ้ำ กรุณาส่งสลิปเดิม
      </p>
      @if (error()) {
        <p role="alert" class="rounded-xl border border-border p-3">
          {{ error() }}
        </p>
      }
      @if (ready()) {
        <button
          hlmBtn
          type="button"
          [disabled]="busy()"
          (click)="redeem()"
          class="min-h-11"
        >
          {{ busy() ? "กำลังตรวจสอบ..." : "เปิดออเดอร์เพื่อชำระเงิน" }}
        </button>
      }
      <p class="text-sm text-muted-foreground">
        ลิงก์ใช้ได้ในอุปกรณ์เดียว ภายใน 30 นาที โปรดไม่ส่งต่อ
      </p>
      <a routerLink="/order/track" class="block text-sm underline"
        >กลับไปออเดอร์ของฉัน</a
      >
    </section>
  `,
})
export class GuestRecoveryPage implements OnInit, OnDestroy {
  private readonly win = inject(DOCUMENT).defaultView;
  private readonly api = inject(GuestOrderApi);
  private readonly session = inject(GuestOrderSession);
  private readonly router = inject(Router);
  private claim: ReturnType<typeof parseRecoveryFragment> = null;
  private accessToken = "";
  private destroyed = false;
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");

  ngOnInit(): void {
    if (this.win) {
      this.claim = parseRecoveryFragment(this.win.location.hash);
      // Do not retain bearer material in the URL, server logs or navigation history.
      this.win.history.replaceState(
        this.win.history.state,
        "",
        this.win.location.pathname + this.win.location.search,
      );
    }
    this.ready.set(!!this.claim);
    if (!this.claim) this.error.set("ลิงก์ไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากร้าน");
  }

  async redeem(): Promise<void> {
    if (!this.claim || !this.win || this.busy() || this.destroyed) return;
    this.busy.set(true);
    this.error.set("");
    const claim = this.claim;
    try {
      if (!this.accessToken) {
        const random = this.win.crypto.getRandomValues(new Uint8Array(32));
        this.accessToken = this.win
          .btoa(String.fromCharCode(...random))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=/g, "");
      }
      const result = await this.api.redeemPaymentRecovery(
        claim.orderId,
        claim.claimToken,
        this.accessToken,
      );
      if (this.destroyed) return;
      if (result.orderId !== claim.orderId)
        throw new Error("Invalid recovery response");
      this.session.rememberTracking(
        result.orderId,
        this.accessToken,
        result.displayNumber,
        Date.parse(result.expiresAt),
      );
      this.claim = null;
      this.accessToken = "";
      this.ready.set(false);
      await this.router.navigateByUrl("/order/track", { replaceUrl: true });
    } catch (error) {
      if (this.destroyed) return;
      if (
        error instanceof HttpErrorResponse &&
        [400, 401, 403, 404, 409].includes(error.status)
      ) {
        this.ready.set(false);
        this.claim = null;
        this.accessToken = "";
        this.error.set(
          "ลิงก์หมดอายุ ถูกใช้แล้ว หรือไม่สามารถกู้คืนได้ กรุณาขอลิงก์ใหม่จากร้าน",
        );
      } else {
        this.error.set(
          "ยังเปิดออเดอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตและลองอีกครั้งในหน้านี้",
        );
      }
    } finally {
      if (!this.destroyed) this.busy.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.claim = null;
    this.accessToken = "";
  }
}
