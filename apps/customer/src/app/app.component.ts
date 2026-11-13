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
                  >พื้นที่ทำงาน</a
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
                        >{{ item.label }}</a
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
                        >{{ item.label }}</a
                      >
                    }
                  }
                  @if (selected.role === "owner") {
                    <a
                      [routerLink]="['/tenants', selected.tenantId, 'staff']"
                      routerLinkActive="active"
                      >พนักงานและสิทธิ์</a
                    >
                  }
                </div>
              }
              @if (canSetUp()) {
                <div class="portal-nav-group">
                  <span class="portal-nav-caption">ตั้งค่า</span>
                  <a routerLink="/settings" routerLinkActive="active"
                    >ตั้งค่าร้าน</a
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
  readonly guestMenu = computed(() =>
    /^\/order(?:\?|#|$)/.test(this.url()),
  );
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
