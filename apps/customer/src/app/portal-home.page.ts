import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { googleLoginFailureNotice } from "./portal-login-feedback";
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
          <div class="portal-landing portal-closed-access">
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
              <span class="portal-eyebrow">สำหรับผู้ดูแลระบบและร้านค้า</span>
              <h1 id="portal-title">
                จัดการร้านอย่างมั่นใจ <span>สำหรับบุคลากรที่ได้รับสิทธิ์</span>
              </h1>
              <p class="portal-lead">
                พื้นที่จัดการร้านนี้จำกัดเฉพาะผู้ดูแลและร้านค้าที่ได้รับอนุญาต
                ผ่านบัญชี Google Workspace ของวิทยาลัยเท่านั้น
              </p>
              <div class="portal-how-it-works portal-access-steps">
                <div><strong>01</strong><span>ผู้ดูแลเพิ่มอีเมล</span></div>
                <div>
                  <strong>02</strong><span>ยืนยันตัวตนผ่าน Google</span>
                </div>
                <div>
                  <strong>03</strong><span>ใช้งานตามสิทธิ์ที่ได้รับ</span>
                </div>
              </div>
              <a class="portal-guest-track" routerLink="/order/track"
                >ติดตามออเดอร์ของฉัน <span aria-hidden="true">→</span></a
              >
              <p class="portal-guest-help">
                ลูกค้าสามารถสแกน QR
                ของร้านเพื่อสั่งอาหารได้โดยไม่ต้องเข้าสู่ระบบ
              </p>
            </div>
            <div class="portal-login-card portal-private-login">
              <img
                class="portal-login-brand-image"
                src="/rcat-pos-logo.webp"
                width="72"
                height="72"
                alt=""
              />
              <span class="portal-eyebrow">บัญชีบุคลากรของวิทยาลัย</span>
              <h2>เข้าสู่ระบบจัดการร้านค้า</h2>
              <p class="portal-private-access-note">
                เฉพาะบัญชี
                <strong>@rcat.ac.th</strong> ที่ได้รับอนุญาตจากผู้ดูแลระบบ
              </p>
              <a
                class="portal-button portal-google-button"
                rcatBtn
                variant="outline"
                href="/api/auth/google/start"
              >
                <svg
                  class="portal-google-mark"
                  aria-hidden="true"
                  focusable="false"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.38-.18-2.04H12v3.85h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.88-1.74 2.99-4.3 2.99-7.34Z" />
                  <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.43l-3.22-2.51c-.9.6-2.04.97-3.39.97-2.6 0-4.8-1.76-5.59-4.12H3.09v2.59A10 10 0 0 0 12 22Z" />
                  <path fill="#FBBC05" d="M6.41 13.91A6 6 0 0 1 6.1 12c0-.66.11-1.3.31-1.91V7.5H3.09A10 10 0 0 0 2 12c0 1.61.39 3.13 1.09 4.5l3.32-2.59Z" />
                  <path fill="#EA4335" d="M12 5.97c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.6 9.6 0 0 0 12 2 10 10 0 0 0 3.09 7.5l3.32 2.59C7.2 7.73 9.4 5.97 12 5.97Z" />
                </svg>
                <span>เข้าสู่ระบบด้วยบัญชี Google</span>
              </a>
              <p class="portal-login-action-note">
                สำหรับผู้ดูแลและร้านค้าที่ได้รับอนุญาตเท่านั้น
              </p>
              <div class="portal-private-help" role="note">
                <strong>ยังไม่มีสิทธิ์เข้าใช้งาน?</strong>
                <span
                  >โปรดติดต่อผู้ดูแลระบบ RCAT POS
                  เพื่อขออนุญาตบัญชีและรับมอบหมายร้านค้า</span
                >
              </div>
              @if (googleLoginError) {
                <p class="portal-login-error" role="alert">
                  {{ googleLoginError }}
                </p>
              }
            </div>
          </div>
        }
        @case ("staff") {
          <section class="v6-home" aria-label="พื้นที่ทำงานร้านค้า">
            <header class="v6-home-heading">
              <div>
                <span class="v6-overline">พื้นที่จัดการร้านค้า</span>
                <h1 id="portal-title">เริ่มงานที่ร้าน</h1>
                <p>จัดการออเดอร์ เมนู และโต๊ะตามสิทธิ์ที่ระบบกำหนด</p>
                @if (
                  session.platformRole() === "super_admin" ||
                  session.platformRole() === "admin"
                ) {
                  <a class="portal-platform-admin-link" routerLink="/platform">
                    จัดการบัญชีและสิทธิ์ผู้ใช้งาน
                  </a>
                }
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
                          <a
                            class="v6-secondary-action"
                            [routerLink]="[
                              '/payments/receiver',
                              store.tenantId,
                              store.storeId,
                            ]"
                          >
                            <span aria-hidden="true">฿</span>
                            บัญชีรับเงินพร้อมเพย์
                          </a>
                          <a
                            class="v6-secondary-action"
                            [routerLink]="[
                              '/payments',
                              store.tenantId,
                              store.storeId,
                            ]"
                          >
                            <span aria-hidden="true">▤</span>
                            ตรวจสลิป
                          </a>
                          <a
                            class="v6-secondary-action"
                            [routerLink]="[
                              '/payments/finance',
                              store.tenantId,
                              store.storeId,
                            ]"
                          >
                            <span aria-hidden="true">≋</span>
                            กระทบยอดและคืนเงิน
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
                    </article>
                  } @empty {
                    <div class="v6-empty-workspace">
                      <h2>ยังไม่มีร้านในบัญชีนี้</h2>
                      @if (canSetUp()) {
                        <p>เริ่มต้นด้วยการสร้างกลุ่มร้านค้าและร้านแรกของคุณ</p>
                        <a
                          routerLink="/settings"
                          class="portal-platform-admin-link"
                        >
                          ตั้งค่าร้านค้าแรก
                        </a>
                      } @else {
                        <p>ติดต่อผู้ดูแลร้านเพื่อขอสิทธิ์เข้าถึงร้านค้า</p>
                      }
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
  private readonly route = inject(ActivatedRoute);
  readonly googleLoginError = googleLoginFailureNotice(
    this.route.snapshot.queryParamMap.get("login"),
  );
  readonly roles = ROLE_LABEL;
  canSetUp(): boolean {
    return (
      this.session.platformRole() === "super_admin" ||
      this.session.platformRole() === "admin" ||
      this.session.stores().some((store) => store.role === "owner")
    );
  }
}
