import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import { HttpInterceptorFn, HttpResponse } from "@angular/common/http";
import {
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  NavigationEnd,
} from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { catchError, tap, throwError } from "rxjs";
import { PortalSession } from "./portal-session.service";
import { permitsRoute } from "./portal-permissions";

export const portalSessionErrors: HttpInterceptorFn = (request, next) => {
  const session = inject(PortalSession);
  const router = inject(Router);
  return next(request).pipe(
    tap((event) => {
      if (
        event instanceof HttpResponse &&
        request.method === "POST" &&
        ["/api/tenants", "/api/invitations/accept"].includes(request.url)
      )
        void session.refresh();
    }),
    catchError((error) => {
      if (
        error.status === 401 &&
        request.url.startsWith("/api/") &&
        !["/api/auth/me", "/api/auth/login"].includes(request.url)
      ) {
        session.expire();
        if (!/^\/order(?:\/|$)/.test(router.url))
          void router.navigateByUrl("/");
      }
      return throwError(() => error);
    }),
  );
};

@Component({
  selector: "rcat-root",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="portal-layout">
      <a class="portal-skip" href="#main">ข้ามไปเนื้อหาหลัก</a>
      <header class="portal-header" [class.portal-header-hidden]="guestMenu()">
        <a class="portal-brand" routerLink="/" aria-label="RCAT POS หน้าแรก">
          <span class="portal-brand-mark" aria-hidden="true">R</span>
          <span class="portal-brand-title"
            ><strong>RCAT <em>POS</em></strong
            ><small>Ordering & Store Management</small></span
          >
        </a>
        <div class="portal-header-actions">
          @if (guestOrder()) {
            <a class="portal-header-link" routerLink="/order/track"
              >ติดตามออเดอร์</a
            >
          } @else if (session.phase() === "staff") {
            <span class="portal-user-context">พื้นที่จัดการร้านค้า</span>
            <button
              type="button"
              class="portal-logout"
              (click)="logout()"
              [disabled]="loggingOut()"
            >
              {{ loggingOut() ? "กำลังออกจากระบบ..." : "ออกจากระบบ" }}
            </button>
          } @else {
            <span class="portal-user-context">ระบบสั่งอาหารผ่าน QR</span>
          }
        </div>
      </header>
      <div
        class="portal-content"
        [class.portal-with-nav]="session.phase() === 'staff' && !guestOrder()"
      >
        @if (session.phase() === "staff" && !guestOrder()) {
          <aside
            class="portal-sidebar"
            [class.portal-nav-open]="mobileNavOpen()"
            aria-label="พื้นที่ทำงาน"
          >
            <div class="portal-workspace-selector">
              <span class="portal-nav-caption">WORKSPACE</span>
              @if (store(); as selected) {
                <label for="portal-store">ร้านที่กำลังทำงาน</label>
                <select
                  id="portal-store"
                  [value]="selected.tenantId + '|' + selected.storeId"
                  (change)="changeStore($event)"
                >
                  @for (
                    item of session.stores();
                    track item.tenantId + item.storeId
                  ) {
                    <option [value]="item.tenantId + '|' + item.storeId">
                      {{ item.storeName }}
                    </option>
                  }
                </select>
                <p class="portal-workspace-meta">{{ selected.tenantName }}</p>
              } @else {
                <p class="portal-workspace-meta">
                  ยังไม่มีร้านค้าที่เข้าถึงได้
                </p>
              }
            </div>
            <button
              type="button"
              class="portal-mobile-nav-toggle"
              aria-controls="portal-main-nav"
              [attr.aria-expanded]="mobileNavOpen()"
              (click)="toggleMobileNav()"
            >
              <span>เมนูจัดการร้าน</span>
              <span aria-hidden="true">{{ mobileNavOpen() ? "−" : "+" }}</span>
            </button>
            <nav
              id="portal-main-nav"
              class="portal-nav"
              aria-label="งานของร้าน"
            >
              <div class="portal-nav-group">
                <span class="portal-nav-caption">ภาพรวม</span>
                <a
                  routerLink="/"
                  routerLinkActive="active"
                  [routerLinkActiveOptions]="{ exact: true }"
                  ><svg
                    class="portal-nav-svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="7" height="8" rx="1.5" />
                    <rect x="14" y="3" width="7" height="5" rx="1.5" />
                    <rect x="14" y="12" width="7" height="9" rx="1.5" />
                    <rect x="3" y="15" width="7" height="6" rx="1.5" /></svg
                  ><span>พื้นที่ทำงาน</span></a
                >
              </div>
              @if (store(); as selected) {
                <div class="portal-nav-group">
                  <span class="portal-nav-caption">งานประจำวัน</span>
                  @for (item of dailyMenu; track item.path) {
                    @if (allowed(item.path)) {
                      <a
                        [routerLink]="[
                          '/',
                          item.path,
                          selected.tenantId,
                          selected.storeId,
                        ]"
                        routerLinkActive="active"
                        ><svg
                          class="portal-nav-svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.8"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M4 4h16v16H4z" />
                          <path d="M8 9h8M8 13h8M8 17h5" /></svg
                        ><span>{{ item.label }}</span></a
                      >
                    }
                  }
                </div>
                <div class="portal-nav-group">
                  <span class="portal-nav-caption">จัดการร้าน</span>
                  @for (item of manageMenu; track item.path) {
                    @if (allowed(item.path)) {
                      <a
                        [routerLink]="[
                          '/',
                          item.path,
                          selected.tenantId,
                          selected.storeId,
                        ]"
                        routerLinkActive="active"
                        ><svg
                          class="portal-nav-svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.8"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          @switch (item.path) {
                            @case ("tables") {
                              <rect x="3" y="4" width="18" height="16" rx="3" />
                              <path d="M3 10h18M9 10v10" />
                            }
                            @case ("catalog") {
                              <path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" />
                            }
                            @case ("inventory") {
                              <path d="m3 7 9-4 9 4v11l-9 4-9-4V7Z" />
                              <path d="m3 7 9 4 9-4M12 11v11" />
                            }
                            @case ("reports") {
                              <rect x="3" y="3" width="18" height="18" rx="3" />
                              <path d="M8 16v-3m4 3V8m4 8v-5" />
                            }
                          }</svg
                        ><span>{{ item.label }}</span></a
                      >
                    }
                  }
                  @if (selected.role === "owner") {
                    <a
                      [routerLink]="['/tenants', selected.tenantId, 'staff']"
                      routerLinkActive="active"
                      ><svg
                        class="portal-nav-svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="9" cy="8" r="3" />
                        <path
                          d="M3 20v-2a6 6 0 0 1 12 0v2M17 11h5m-2.5-2.5v5"
                        /></svg
                      ><span>พนักงานและสิทธิ์</span></a
                    >
                  }
                </div>
              }
              @if (canSetUp()) {
                <div class="portal-nav-group">
                  <span class="portal-nav-caption">ตั้งค่า</span>
                  <a routerLink="/settings" routerLinkActive="active"
                    ><svg
                      class="portal-nav-svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path
                        d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"
                      /></svg
                    ><span>ตั้งค่าร้าน</span></a
                  >
                </div>
              }
            </nav>
            <p class="portal-nav-hint">เมนูแสดงตามสิทธิ์ที่ได้รับจากระบบ</p>
          </aside>
        }
        <main id="main" tabindex="-1">
          @if (session.notice()) {
            <p class="portal-session-notice" role="status">
              {{ session.notice() }}
            </p>
          }
          @if (message()) {
            <p class="portal-session-notice portal-session-error" role="alert">
              {{ message() }}
            </p>
          }
          <router-outlet />
        </main>
      </div>
      <footer class="portal-footer">
        RCAT POS · ระบบสั่งอาหารและจัดการร้านค้า · ยังไม่มีการชำระเงินผ่านระบบ
      </footer>
    </div>
  `,
})
export class AppComponent {
  readonly session = inject(PortalSession);
  private readonly router = inject(Router);
  readonly url = signal(this.router.url);
  readonly loggingOut = signal(false);
  readonly mobileNavOpen = signal(false);
  readonly message = signal("");
  readonly guestOrder = computed(() =>
    /^\/order(?:\/|\?|#|$)/.test(this.url()),
  );
  readonly guestMenu = computed(() => /^\/order(?:\?|#|$)/.test(this.url()));
  readonly store = computed(() => {
    const segments = this.url().split(/[/?#]/);
    return (
      this.session.stores().find((item) => segments.includes(item.storeId)) ??
      this.session.stores().find((item) => segments.includes(item.tenantId)) ??
      this.session.stores()[0]
    );
  });
  readonly dailyMenu = [{ path: "orders", label: "ออเดอร์" }];
  readonly manageMenu = [
    { path: "tables", label: "โต๊ะและ QR" },
    { path: "catalog", label: "เมนูและราคา" },
    { path: "inventory", label: "สต็อกและวัตถุดิบ" },
    { path: "reports", label: "รายงาน" },
  ];
  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.url.set(event.urlAfterRedirects);
        this.mobileNavOpen.set(false);
      }
    });
    void this.session.configure();
    void this.session.ensure();
  }
  allowed(kind: string): boolean {
    const store = this.store();
    return (
      !!store &&
      permitsRoute(this.session.stores(), kind, store.tenantId, store.storeId)
    );
  }
  canSetUp(): boolean {
    return (
      !this.session.stores().length ||
      this.session.stores().some((store) => store.role === "owner")
    );
  }
  toggleMobileNav(): void {
    this.mobileNavOpen.update((open) => !open);
  }
  changeStore(event: Event): void {
    const store = this.session
      .stores()
      .find(
        (item) =>
          item.tenantId + "|" + item.storeId ===
          (event.target as HTMLSelectElement).value,
      );
    if (store)
      void this.router.navigate(["/orders", store.tenantId, store.storeId]);
  }
  async logout(): Promise<void> {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    this.message.set("");
    try {
      await this.session.logout();
      await this.router.navigateByUrl("/");
    } catch {
      this.message.set("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      this.loggingOut.set(false);
    }
  }
}
