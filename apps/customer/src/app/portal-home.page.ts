import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { googleLoginFailureNotice } from "./portal-login-feedback";
import { PortalSession } from "./portal-session.service";
import { ROLE_LABEL } from "../../../merchant/src/app/order-board.domain";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmCard, HlmCardContent, HlmCardHeader } from "@spartan-ng/helm/card";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    HlmButton,
    HlmBadge,
    HlmCard,
    HlmCardContent,
    HlmCardHeader,
  ],
  template: `
    <section class="min-w-0" aria-labelledby="portal-title">
      @switch (session.phase()) {
        @case ("loading") {
          <div
            class="mx-auto grid min-h-[50dvh] max-w-lg content-center gap-4 px-4 py-12 text-center"
          >
            <span
              class="text-xs font-semibold tracking-widest text-muted-foreground"
              >RCAT POS</span
            >
            <h1
              id="portal-title"
              class="text-2xl font-semibold text-foreground"
            >
              RCAT POS
            </h1>
            <p role="status" class="text-sm leading-7 text-muted-foreground">
              กำลังเปิดพื้นที่ทำงานและตรวจสอบสิทธิ์...
            </p>
          </div>
        }
        @case ("error") {
          <div
            class="mx-auto grid min-h-[50dvh] max-w-lg content-center justify-items-center gap-4 px-4 py-12 text-center"
          >
            <span
              class="text-xs font-semibold tracking-widest text-muted-foreground"
              >CONNECTION</span
            >
            <h1
              id="portal-title"
              class="text-2xl font-semibold text-foreground"
            >
              ยังเชื่อมต่อระบบไม่ได้
            </h1>
            <p class="text-sm leading-7 text-muted-foreground">
              ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง
            </p>
            <button
              hlmBtn
              type="button"
              class="min-h-11 rounded-xl px-6"
              (click)="session.refresh()"
            >
              ลองเชื่อมต่ออีกครั้ง
            </button>
          </div>
        }
        @case ("guest") {
          <div
            class="mx-auto grid w-full max-w-5xl items-center gap-8 px-4 py-10 sm:px-6 md:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] md:gap-10 md:py-16"
          >
            <section class="grid min-w-0 gap-5" aria-labelledby="portal-title">
              <div class="flex items-center gap-3">
                <img
                  src="/rcat-pos-logo.webp"
                  width="64"
                  height="64"
                  alt="RCAT POS System"
                  class="size-14 rounded-2xl object-contain"
                />
                <span
                  class="text-sm font-semibold tracking-wide text-muted-foreground"
                  >RCAT POS SYSTEM</span
                >
              </div>
              <div class="grid gap-3">
                <span class="text-sm font-medium text-primary"
                  >สำหรับผู้ดูแลระบบและร้านค้า</span
                >
                <h1
                  id="portal-title"
                  class="max-w-xl text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl"
                >
                  จัดการร้านอย่างเป็นระบบ
                </h1>
                <p
                  class="max-w-prose text-base leading-8 text-muted-foreground"
                >
                  พื้นที่จัดการร้านสำหรับบุคลากรที่ได้รับสิทธิ์ ผ่านบัญชี Google
                  Workspace ของวิทยาลัย
                </p>
              </div>
              <ol
                class="grid gap-2 text-sm leading-6 text-muted-foreground"
                aria-label="ขั้นตอนการเข้าใช้งาน"
              >
                <li class="flex items-center gap-3">
                  <span
                    class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                    >1</span
                  >ผู้ดูแลเพิ่มสิทธิ์บัญชี
                </li>
                <li class="flex items-center gap-3">
                  <span
                    class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                    >2</span
                  >ยืนยันตัวตนผ่าน Google
                </li>
                <li class="flex items-center gap-3">
                  <span
                    class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                    >3</span
                  >ใช้งานเมนูตามสิทธิ์ของร้าน
                </li>
              </ol>
              <div class="grid gap-2 border-t border-border pt-4">
                <a
                  routerLink="/order/track"
                  class="w-fit rounded-lg py-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >ติดตามออเดอร์ของฉัน</a
                >
                <p class="text-sm leading-6 text-muted-foreground">
                  ลูกค้าสแกน QR ของร้านเพื่อสั่งอาหารได้โดยไม่ต้องเข้าสู่ระบบ
                </p>
              </div>
            </section>
            <section
              class="grid min-w-0 gap-5 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8"
              aria-labelledby="portal-login-title"
            >
              <img
                src="/rcat-pos-logo.webp"
                width="56"
                height="56"
                alt=""
                class="size-14 rounded-2xl object-contain"
              />
              <div class="grid gap-2">
                <span class="text-sm font-medium text-muted-foreground"
                  >บัญชีบุคลากรของวิทยาลัย</span
                >
                <h2
                  id="portal-login-title"
                  class="text-xl font-semibold text-foreground"
                >
                  เข้าสู่ระบบจัดการร้านค้า
                </h2>
                <p class="text-sm leading-7 text-muted-foreground">
                  เฉพาะบัญชี
                  <strong class="font-semibold text-foreground"
                    >@rcat.ac.th</strong
                  >
                  ที่ได้รับอนุญาตจากผู้ดูแลระบบ
                </p>
              </div>
              <a
                hlmBtn
                variant="outline"
                class="min-h-12 w-full justify-center gap-3 rounded-xl border border-border bg-card px-4 text-base font-semibold text-foreground shadow-sm hover:bg-accent"
                href="/api/auth/google/start"
              >
                <svg
                  class="size-6 shrink-0"
                  aria-hidden="true"
                  focusable="false"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill="#4285F4"
                    d="M21.6 12.23c0-.71-.06-1.38-.18-2.04H12v3.85h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.88-1.74 2.99-4.3 2.99-7.34Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 4.96-.9 6.61-2.43l-3.22-2.51c-.9.6-2.04.97-3.39.97-2.6 0-4.8-1.76-5.59-4.12H3.09v2.59A10 10 0 0 0 12 22Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M6.41 13.91A6 6 0 0 1 6.1 12c0-.66.11-1.3.31-1.91V7.5H3.09A10 10 0 0 0 2 12c0 1.61.39 3.13 1.09 4.5l3.32-2.59Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.97c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.6 9.6 0 0 0 12 2 10 10 0 0 0 3.09 7.5l3.32 2.59C7.2 7.73 9.4 5.97 12 5.97Z"
                  />
                </svg>
                <span>Sign in with Google</span>
              </a>
              <p class="text-center text-xs leading-6 text-muted-foreground">
                สำหรับผู้ดูแลและร้านค้าที่ได้รับอนุญาตเท่านั้น
              </p>
              <div
                class="grid gap-2 rounded-2xl bg-secondary p-4 text-sm leading-6"
              >
                <strong class="font-semibold text-foreground"
                  >ยังไม่มีสิทธิ์เข้าใช้งาน?</strong
                >
                <span class="text-muted-foreground"
                  >โปรดติดต่อผู้ดูแลระบบ RCAT POS
                  เพื่อขอสิทธิ์บัญชีและร้านค้า</span
                >
              </div>
              @if (googleLoginError) {
                <p
                  role="alert"
                  class="rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm leading-6 text-destructive"
                >
                  {{ googleLoginError }}
                </p>
              }
            </section>
          </div>
        }

        @case ("staff") {
          <section class="grid min-w-0 gap-6" aria-label="พื้นที่ทำงานร้านค้า">
            <header
              class="flex min-w-0 flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="grid min-w-0 gap-2">
                <p class="text-sm font-medium text-muted-foreground">
                  พื้นที่จัดการร้านค้า
                </p>
                <h1
                  id="portal-title"
                  class="text-2xl font-semibold leading-9 tracking-tight text-foreground"
                >
                  เริ่มงานที่ร้าน
                </h1>
                <p class="text-sm leading-6 text-muted-foreground">
                  จัดการออเดอร์ เมนู และโต๊ะตามสิทธิ์ที่ระบบกำหนด
                </p>
                @if (
                  session.platformRole() === "super_admin" ||
                  session.platformRole() === "admin"
                ) {
                  <a
                    hlmBtn
                    variant="outline"
                    class="min-h-11 w-fit"
                    routerLink="/platform"
                  >
                    จัดการบัญชีและสิทธิ์ผู้ใช้งาน
                  </a>
                }
              </div>
              <span hlmBadge variant="secondary" class="w-fit text-sm">
                ร้านที่เข้าถึงได้ {{ session.stores().length }}
              </span>
            </header>

            <div
              class="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]"
            >
              <section
                class="grid min-w-0 gap-4"
                aria-labelledby="portal-store-list"
              >
                <div class="grid gap-1">
                  <h2
                    id="portal-store-list"
                    class="text-lg font-semibold text-foreground"
                  >
                    ร้านค้าของคุณ
                  </h2>
                  <p class="text-sm text-muted-foreground">
                    เลือกงานที่ต้องการเริ่มได้ทันที
                  </p>
                </div>
                <div class="grid min-w-0 gap-4">
                  @for (
                    store of session.stores();
                    track store.tenantId + store.storeId
                  ) {
                    <article hlmCard size="sm" class="min-w-0">
                      <div hlmCardHeader>
                        <div class="flex min-w-0 items-center gap-3">
                          <span
                            class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-lg font-semibold text-secondary-foreground"
                            aria-hidden="true"
                          >
                            {{ store.storeName.slice(0, 1) }}
                          </span>
                          <div class="min-w-0 flex-1">
                            <h3
                              class="break-words text-base font-semibold leading-6 text-card-foreground"
                            >
                              {{ store.storeName }}
                            </h3>
                            <p
                              class="break-words text-sm text-muted-foreground"
                            >
                              {{ store.tenantName }}
                            </p>
                          </div>
                          <span hlmBadge variant="secondary">{{
                            roles[store.role]
                          }}</span>
                        </div>
                      </div>
                      <div hlmCardContent class="grid gap-3">
                        <a
                          hlmBtn
                          class="min-h-12 w-full justify-start rounded-xl text-base"
                          [routerLink]="[
                            '/orders',
                            store.tenantId,
                            store.storeId,
                          ]"
                        >
                          เปิดกระดานออเดอร์
                        </a>
                        <p class="text-sm leading-6 text-muted-foreground">
                          รับรายการและติดตามงานครัว
                        </p>
                        @if (
                          store.role === "owner" || store.role === "manager"
                        ) {
                          <details
                            class="group rounded-xl border border-border bg-background"
                          >
                            <summary
                              class="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              <span>งานจัดการเพิ่มเติม</span>
                              <span
                                class="text-xs text-muted-foreground"
                                aria-hidden="true"
                                >เปิดเมนู</span
                              >
                            </summary>
                            <nav
                              class="grid gap-2 border-t border-border p-3"
                              [attr.aria-label]="
                                'งานจัดการของ ' + store.storeName
                              "
                            >
                              <a
                                hlmBtn
                                variant="outline"
                                class="min-h-11 w-full justify-start"
                                [routerLink]="[
                                  '/catalog',
                                  store.tenantId,
                                  store.storeId,
                                ]"
                              >
                                เมนูและราคา
                              </a>
                              <a
                                hlmBtn
                                variant="outline"
                                class="min-h-11 w-full justify-start"
                                [routerLink]="[
                                  '/tables',
                                  store.tenantId,
                                  store.storeId,
                                ]"
                              >
                                โต๊ะและ QR
                              </a>
                              <a
                                hlmBtn
                                variant="outline"
                                class="min-h-11 w-full justify-start"
                                [routerLink]="[
                                  '/payments/receiver',
                                  store.tenantId,
                                  store.storeId,
                                ]"
                              >
                                บัญชีรับเงินพร้อมเพย์
                              </a>
                              <a
                                hlmBtn
                                variant="outline"
                                class="min-h-11 w-full justify-start"
                                [routerLink]="[
                                  '/payments',
                                  store.tenantId,
                                  store.storeId,
                                ]"
                              >
                                ตรวจสลิป
                              </a>
                              <a
                                hlmBtn
                                variant="outline"
                                class="min-h-11 w-full justify-start"
                                [routerLink]="[
                                  '/payments/finance',
                                  store.tenantId,
                                  store.storeId,
                                ]"
                              >
                                กระทบยอดและคืนเงิน
                              </a>
                              @if (store.role === "owner") {
                                <a
                                  hlmBtn
                                  variant="outline"
                                  class="min-h-11 w-full justify-start"
                                  [routerLink]="[
                                    '/tenants',
                                    store.tenantId,
                                    'staff',
                                  ]"
                                >
                                  พนักงานและสิทธิ์
                                </a>
                              }
                            </nav>
                          </details>
                        }
                      </div>
                    </article>
                  } @empty {
                    <div hlmCard size="sm">
                      <div hlmCardContent class="grid gap-3">
                        <h3 class="text-base font-semibold text-foreground">
                          ยังไม่มีร้านในบัญชีนี้
                        </h3>
                        @if (canSetUp()) {
                          <p class="text-sm text-muted-foreground">
                            เริ่มต้นด้วยการสร้างกลุ่มร้านค้าและร้านแรกของคุณ
                          </p>
                          <a
                            hlmBtn
                            routerLink="/settings"
                            class="min-h-11 w-fit"
                          >
                            ตั้งค่าร้านค้าแรก
                          </a>
                        } @else {
                          <p class="text-sm text-muted-foreground">
                            ติดต่อผู้ดูแลร้านเพื่อขอสิทธิ์เข้าถึงร้านค้า
                          </p>
                        }
                      </div>
                    </div>
                  }
                </div>
              </section>

              <aside
                hlmCard
                size="sm"
                class="hidden min-w-0 self-start xl:flex"
                aria-labelledby="portal-workflow-help"
              >
                <div hlmCardHeader>
                  <h2
                    id="portal-workflow-help"
                    class="text-base font-semibold text-card-foreground"
                  >
                    ขั้นตอนการทำงาน
                  </h2>
                </div>
                <div hlmCardContent class="grid gap-4">
                  <ol class="grid gap-4 text-sm leading-6">
                    <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                      <span class="font-semibold tabular-nums text-primary"
                        >01</span
                      >
                      <div>
                        <strong class="font-semibold text-foreground"
                          >รับออเดอร์</strong
                        >
                        <p class="text-muted-foreground">
                          ลูกค้าสแกน QR และส่งรายการเข้าร้านโดยตรง
                        </p>
                      </div>
                    </li>
                    <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                      <span class="font-semibold tabular-nums text-primary"
                        >02</span
                      >
                      <div>
                        <strong class="font-semibold text-foreground"
                          >เตรียมและส่งอาหาร</strong
                        >
                        <p class="text-muted-foreground">
                          ร้านรับรายการและอัปเดตสถานะได้ทันที
                        </p>
                      </div>
                    </li>
                    <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                      <span class="font-semibold tabular-nums text-primary"
                        >03</span
                      >
                      <div>
                        <strong class="font-semibold text-foreground"
                          >จัดการร้าน</strong
                        >
                        <p class="text-muted-foreground">
                          ตรวจสอบเมนู โต๊ะ และสต็อกตามสิทธิ์ของคุณ
                        </p>
                      </div>
                    </li>
                  </ol>
                  <p
                    class="rounded-xl bg-secondary p-3 text-sm leading-6 text-secondary-foreground"
                  >
                    การรับออเดอร์ไม่ใช่การยืนยันชำระเงิน
                  </p>
                  @if (canSetUp()) {
                    <a
                      hlmBtn
                      variant="outline"
                      class="min-h-11 w-full justify-start"
                      routerLink="/settings"
                    >
                      ตั้งค่าร้านและบุคลากร
                    </a>
                  }
                </div>
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
