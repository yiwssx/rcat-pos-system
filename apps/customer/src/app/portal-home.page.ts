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

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
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
              (click)="session.refresh()"
            >
              ลองเชื่อมต่ออีกครั้ง
            </button>
          </div>
        }
        @case ("guest") {
          <div class="portal-landing">
            <div class="portal-landing-intro">
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
              <span class="portal-login-icon" aria-hidden="true">R</span>
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
                <a class="portal-button" href="/api/auth/google/start"
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
          <div class="portal-workspace-head">
            <div>
              <span class="portal-eyebrow">MERCHANT WORKSPACE</span>
              <h1 id="portal-title">เริ่มงานที่ร้าน</h1>
              <p class="portal-lead">
                เลือกงานจากร้านที่บัญชีนี้เข้าถึงได้ เมนูจะปรับตามสิทธิ์ของคุณ
              </p>
            </div>
            <span class="portal-workspace-count"
              >ร้านค้าที่เข้าถึงได้
              <strong>{{ session.stores().length }}</strong></span
            >
          </div>
          <div class="portal-section-heading">
            <span class="portal-eyebrow">YOUR STORES</span>
            <h2>ร้านค้าของคุณ</h2>
          </div>
          <div class="portal-stores">
            @for (
              store of session.stores();
              track store.tenantId + store.storeId
            ) {
              <article class="portal-panel portal-store-card">
                <div class="portal-store-card-head">
                  <span class="portal-store-avatar" aria-hidden="true">{{
                    store.storeName.slice(0, 1)
                  }}</span>
                  <span class="portal-role">{{ roles[store.role] }}</span>
                </div>
                <h3>{{ store.storeName }}</h3>
                <p class="portal-store-tenant">{{ store.tenantName }}</p>
                <a
                  class="portal-button portal-store-action"
                  [routerLink]="['/orders', store.tenantId, store.storeId]"
                  >เปิดกระดานออเดอร์ <span aria-hidden="true">→</span></a
                >
                @if (store.role === "owner" || store.role === "manager") {
                  <div class="portal-store-links">
                    <a
                      [routerLink]="['/catalog', store.tenantId, store.storeId]"
                      >เมนูและราคา</a
                    >
                    <a [routerLink]="['/tables', store.tenantId, store.storeId]"
                      >โต๊ะและ QR</a
                    >
                  </div>
                }
                @if (store.role === "owner") {
                  <a
                    class="portal-store-staff"
                    [routerLink]="['/tenants', store.tenantId, 'staff']"
                    >พนักงานและสิทธิ์</a
                  >
                }
                @if (
                  session.localLogin() &&
                  store.storeId === "70000000-0000-4000-8000-000000000002" &&
                  store.role === "owner"
                ) {
                  <div class="portal-local-fixture">
                    <button
                      type="button"
                      class="portal-button portal-secondary"
                      (click)="demoOrder()"
                      [disabled]="busy()"
                    >
                      เปิดโต๊ะทดลองเพื่อสั่งอาหาร
                    </button>
                    <small>เริ่มรอบโต๊ะทดลองใหม่และยกเลิกรอบเดิม</small>
                  </div>
                }
              </article>
            } @empty {
              <div class="portal-state-screen">
                <h2>ยังไม่มีร้านในบัญชีนี้</h2>
                <p>
                  ขอสิทธิ์จากเจ้าของร้าน
                  หรือเปิดหน้าตั้งค่าเพื่อเริ่มสร้างร้านของคุณ
                </p>
              </div>
            }
          </div>
          @if (canSetUp()) {
            <div class="portal-setup-banner">
              <div>
                <strong>ต้องการจัดการร้านหรือบุคลากร?</strong>
                <p>
                  สร้างร้านใหม่ รับคำเชิญ
                  และจัดการสิทธิ์เฉพาะร้านที่คุณเป็นเจ้าของ
                </p>
              </div>
              <a class="portal-button portal-secondary" routerLink="/settings"
                >ตั้งค่าร้าน</a
              >
            </div>
          }
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
