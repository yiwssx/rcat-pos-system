import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from "@angular/core";
import { DOCUMENT } from "@angular/common";
import {
  HttpClient,
  HttpHeaders,
  HttpErrorResponse,
} from "@angular/common/http";
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { PortalSession } from "./portal-session.service";
import { ROLE_LABEL } from "../../../merchant/src/app/order-board.domain";
import { RcatButtonDirective } from "@rcat/ui";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RcatButtonDirective],
  template: `
    <section class="portal-home" aria-labelledby="portal-title">
      @switch (session.phase()) {
        @case ("loading") {
          <div class="portal-state-screen">
            <span class="portal-eyebrow">RCAT POS</span>
            <h1 id="portal-title">RCAT POS</h1>
            <p role="status">กำลังเปิดพื้นที่ทำงานและตรวจสอบสิทธิ์...</p>
          </div>
        }
        @case ("error") {
          <div class="portal-state-screen">
            <span class="portal-eyebrow">CONNECTION</span>
            <h1 id="portal-title">ยังเชื่อมต่อระบบไม่ได้</h1>
            <p>ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง</p>
            <button
              type="button"
              class="portal-button"
              rcatBtn
              (click)="session.refresh()"
            >
              ลองเชื่อมต่ออีกครั้ง
            </button>
          </div>
        }
        @case ("guest") {
          <div class="portal-landing">
            <div class="portal-landing-intro">
              <div class="portal-hero-brand">
                <img
                  src="/rcat-pos-logo.webp"
                  width="68"
                  height="68"
                  alt="โลโก้ RCAT POS System"
                />
                <span>RCAT POS SYSTEM</span>
              </div>
              <span class="portal-eyebrow">RCAT POS / QR ORDERING</span>
              <h1 id="portal-title">
                สั่งอาหารง่าย <span>จัดการร้านในที่เดียว</span>
              </h1>
              <p class="portal-lead">
                ลูกค้าสแกน QR ที่โต๊ะเพื่อเลือกเมนูและติดตามออเดอร์ได้ทันที
                โดยไม่ต้องสมัครบัญชีหรือติดตั้งแอป
              </p>
              <div class="portal-how-it-works">
                <div><strong>01</strong><span>สแกน QR โต๊ะ</span></div>
                <div><strong>02</strong><span>เลือกเมนู</span></div>
                <div><strong>03</strong><span>ติดตามออเดอร์</span></div>
              </div>
              <a class="portal-guest-track" routerLink="/order/track"
                >ติดตามออเดอร์ของฉัน <span aria-hidden="true">→</span></a
              >
              <p class="portal-guest-help">
                QR สั่งอาหารไม่ใช่ QR ชำระเงิน และยังไม่มีการรับชำระเงินผ่านระบบ
              </p>
            </div>
            <div class="portal-login-card">
              <img
                class="portal-login-brand-image"
                src="/rcat-pos-logo.webp"
                width="72"
                height="72"
                alt=""
              />
              <span class="portal-eyebrow">MERCHANT WORKSPACE</span>
              <h2>เข้าสู่พื้นที่จัดการร้าน</h2>
              <p>สำหรับเจ้าของร้านและพนักงานที่ได้รับสิทธิ์เท่านั้น</p>
              @if (session.localLogin()) {
                <form (submit)="login($event)">
                  <label for="portal-email">อีเมลบัญชีทดลอง</label>
                  <input
                    id="portal-email"
                    type="email"
                    autocomplete="username"
                    [value]="email()"
                    (input)="email.set(value($event))"
                    required
                  />
                  <label for="portal-password">รหัสผ่านทดลอง</label>
                  <input
                    id="portal-password"
                    type="password"
                    autocomplete="current-password"
                    [value]="password()"
                    (input)="password.set(value($event))"
                    required
                  />
                  <button
                    type="submit"
                    class="portal-button"
                    [disabled]="busy()"
                  >
                    {{ busy() ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบทดลอง" }}
                  </button>
                </form>
                <small>ใช้บัญชีและรหัสผ่านจาก Terminal ของ Local Demo</small>
              } @else {
                <a class="portal-button" rcatBtn href="/api/auth/google/start"
                  >เข้าสู่ระบบด้วย Google @rcat.ac.th</a
                >
              }
              @if (error()) {
                <p class="portal-login-error" role="alert">{{ error() }}</p>
              }
            </div>
          </div>
        }
        @case ("staff") {
          <section class="v6-home" aria-label="พื้นที่ทำงานร้านค้า">
            <header class="v6-home-heading">
              <div>
                <span class="v6-overline">RCAT POS · MERCHANT DESK</span>
                <h1 id="portal-title">เริ่มงานที่ร้าน</h1>
                <p>จัดการออเดอร์ เมนู และโต๊ะในพื้นที่ทำงานเดียว</p>
              </div>
              <span class="v6-workspace-total">
                <span aria-hidden="true" class="v6-total-mark"></span>
                ร้านที่เข้าถึงได้
                <strong>{{ session.stores().length }}</strong>
              </span>
            </header>
            <div class="v6-home-columns">
              <div class="v6-home-primary">
                <div class="v6-section-top">
                  <div>
                    <h2>ร้านค้าของคุณ</h2>
                    <p>เลือกงานที่ต้องการเริ่มได้ทันที</p>
                  </div>
                </div>
                <div class="portal-stores v6-store-list">
                  @for (
                    store of session.stores();
                    track store.tenantId + store.storeId
                  ) {
                    <article class="portal-store-card v6-store-card">
                      <div class="v6-store-title-row">
                        <span class="v6-store-icon" aria-hidden="true">
                          {{ store.storeName.slice(0, 1) }}
                        </span>
                        <div class="v6-store-title">
                          <h3>{{ store.storeName }}</h3>
                          <p>{{ store.tenantName }}</p>
                        </div>
                        <span class="v6-store-role">{{
                          roles[store.role]
                        }}</span>
                      </div>
                      <div class="v6-store-action-grid">
                        <a
                          class="v6-main-action"
                          [routerLink]="[
                            '/orders',
                            store.tenantId,
                            store.storeId,
                          ]"
                        >
                          <span class="v6-action-glyph" aria-hidden="true"
                            >≡</span
                          >
                          <span>
                            <strong>เปิดกระดานออเดอร์</strong>
                            <small>รับรายการและติดตามงานครัว</small>
                          </span>
                          <span aria-hidden="true">›</span>
                        </a>
                        @if (
                          store.role === "owner" || store.role === "manager"
                        ) {
                          <a
                            class="v6-secondary-action"
                            [routerLink]="[
                              '/catalog',
                              store.tenantId,
                              store.storeId,
                            ]"
                          >
                            <span aria-hidden="true">☷</span>
                            เมนูและราคา
                          </a>
                          <a
                            class="v6-secondary-action"
                            [routerLink]="[
                              '/tables',
                              store.tenantId,
                              store.storeId,
                            ]"
                          >
                            <span aria-hidden="true">▦</span>
                            โต๊ะและ QR
                          </a>
                        }
                        @if (store.role === "owner") {
                          <a
                            class="v6-secondary-action"
                            [routerLink]="['/tenants', store.tenantId, 'staff']"
                          >
                            <span aria-hidden="true">♙</span>
                            พนักงานและสิทธิ์
                          </a>
                        }
                      </div>
                      @if (
                        session.localLogin() &&
                        store.storeId ===
                          "70000000-0000-4000-8000-000000000002" &&
                        store.role === "owner"
                      ) {
                        <div class="portal-local-fixture v6-local-demo">
                          <button
                            type="button"
                            class="v6-local-launch"
                            (click)="demoOrder()"
                            [disabled]="busy()"
                          >
                            เปิดโต๊ะทดลองเพื่อสั่งอาหาร
                          </button>
                          <small
                            >ข้อมูลทดลองเท่านั้น ·
                            เปิดรอบใหม่และยกเลิกรอบเดิม</small
                          >
                        </div>
                      }
                    </article>
                  } @empty {
                    <div class="v6-empty-workspace">
                      <h2>ยังไม่มีร้านในบัญชีนี้</h2>
                      <p>
                        ขอสิทธิ์จากเจ้าของร้าน หรือตั้งค่าร้านเพื่อเริ่มใช้งาน
                      </p>
                    </div>
                  }
                </div>
              </div>
              <aside class="v6-home-aside" aria-labelledby="v6-get-started">
                <div class="v6-aside-top">
                  <span class="v6-aside-dot" aria-hidden="true"></span>
                  <h2 id="v6-get-started">ขั้นตอนการทำงาน</h2>
                </div>
                <ol class="v6-steps">
                  <li>
                    <span class="v6-step-number">01</span>
                    <div>
                      <strong>รับออเดอร์</strong>
                      <p>ลูกค้าสแกน QR และส่งรายการเข้าร้านโดยตรง</p>
                    </div>
                  </li>
                  <li>
                    <span class="v6-step-number">02</span>
                    <div>
                      <strong>เตรียมและส่งอาหาร</strong>
                      <p>ร้านรับรายการและอัปเดตสถานะได้ทันที</p>
                    </div>
                  </li>
                  <li>
                    <span class="v6-step-number">03</span>
                    <div>
                      <strong>จัดการร้าน</strong>
                      <p>ตรวจสอบเมนู โต๊ะ และสต็อกตามสิทธิ์ของคุณ</p>
                    </div>
                  </li>
                </ol>
                <p class="v6-aside-notice">
                  การรับออเดอร์ไม่ใช่การยืนยันชำระเงิน
                </p>
                @if (canSetUp()) {
                  <a class="v6-manage-link" routerLink="/settings">
                    ตั้งค่าร้านและบุคลากร
                    <span aria-hidden="true">›</span>
                  </a>
                }
              </aside>
            </div>
          </section>
        }
      }
    </section>
  `,
})
export class PortalHomePage {
  readonly session = inject(PortalSession);
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  readonly roles = ROLE_LABEL;
  readonly email = signal("owner@demo.invalid");
  readonly password = signal("");
  readonly busy = signal(false);
  readonly error = signal("");
  canSetUp(): boolean {
    return (
      this.session.stores().length === 0 ||
      this.session.stores().some((store) => store.role === "owner")
    );
  }
  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  async demoOrder(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.session.notice.set("");
    try {
      const token =
        this.document.cookie
          .split("; ")
          .find((value) => value.startsWith("__Host-rcat_csrf="))
          ?.split("=")[1] ?? "";
      const round = await firstValueFrom(
        this.http.post<{ orderingUrl: string }>(
          "/api/tenants/70000000-0000-4000-8000-000000000001/stores/70000000-0000-4000-8000-000000000002/tables/70000000-0000-4000-8000-000000000005/rotate",
          {},
          { headers: new HttpHeaders({ "X-CSRF-Token": token }) },
        ),
      );
      const target = new URL(round.orderingUrl);
      if (
        target.origin !== this.document.location.origin ||
        target.pathname !== "/order"
      )
        throw new Error("Invalid demo URL");
      this.document.location.assign(target.href);
    } catch {
      this.session.notice.set("เปิดโต๊ะทดลองไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      this.busy.set(false);
    }
  }
  async login(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    try {
      await this.session.login(this.email(), this.password());
      this.password.set("");
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse && error.status === 401
          ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
          : "เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    } finally {
      this.busy.set(false);
    }
  }
}
