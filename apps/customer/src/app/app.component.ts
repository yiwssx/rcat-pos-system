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
  RouterOutlet,
  NavigationEnd,
} from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { catchError, tap, throwError } from "rxjs";
import { HlmButton } from "@spartan-ng/helm/button";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideMenu,
  lucidePanelLeftClose,
  lucidePanelLeftOpen,
} from "@ng-icons/lucide";
import {
  HlmSheet,
  HlmSheetContent,
  HlmSheetHeader,
  HlmSheetPortal,
  HlmSheetTitle,
} from "@spartan-ng/helm/sheet";
import { PortalSession } from "./portal-session.service";
import { PortalWorkspaceNavComponent } from "./portal-workspace-nav.component";

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
  providers: [
    provideIcons({ lucideMenu, lucidePanelLeftClose, lucidePanelLeftOpen }),
  ],
  imports: [
    NgIcon,
    RouterLink,
    RouterOutlet,
    HlmButton,
    HlmSheet,
    HlmSheetContent,
    HlmSheetHeader,
    HlmSheetPortal,
    HlmSheetTitle,
    PortalWorkspaceNavComponent,
  ],
  template: `
    <div
      class="flex min-h-dvh min-w-0 flex-col bg-background font-sans text-foreground"
    >
      <a
        href="#main"
        class="sr-only fixed left-4 top-4 z-50 rounded-lg bg-card px-4 py-3 text-foreground shadow-lg focus:not-sr-only"
        >ข้ามไปเนื้อหาหลัก</a
      >

      @if (!guestMenu()) {
        <header
          class="relative z-30 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6 lg:px-8"
        >
          <div class="flex min-w-0 items-center gap-3">
            @if (staffWorkspace()) {
              <button
                hlmBtn
                type="button"
                variant="outline"
                size="icon-lg"
                class="min-h-11 min-w-11 lg:hidden"
                aria-label="เปิดเมนูจัดการร้าน"
                aria-controls="portal-mobile-navigation"
                [attr.aria-expanded]="mobileNavOpen()"
                (click)="toggleMobileNav()"
              >
                <ng-icon name="lucideMenu" aria-hidden="true" />
              </button>
            }
            <a
              routerLink="/"
              aria-label="RCAT POS หน้าแรก"
              class="flex min-w-0 items-center gap-3 rounded-xl no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <img
                src="/rcat-pos-logo.webp"
                alt=""
                width="44"
                height="44"
                class="size-11 shrink-0 rounded-xl object-contain"
              />
              <span class="grid min-w-0 gap-0.5">
                <strong
                  class="hidden whitespace-nowrap text-sm font-semibold tracking-tight text-brand-foreground min-[360px]:block sm:text-lg"
                  >RCAT POS</strong
                >
                <span
                  class="hidden text-xs leading-4 text-muted-foreground sm:block"
                  >Ordering & Store Management</span
                >
              </span>
            </a>
          </div>
          <div class="flex shrink-0 items-center gap-2 sm:gap-3">
            @if (guestOrder()) {
              <a
                routerLink="/order/track"
                class="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                ติดตามออเดอร์
              </a>
            } @else if (staffWorkspace()) {
              <span class="hidden text-sm text-muted-foreground md:inline"
                >พื้นที่จัดการร้านค้า</span
              >
              <button
                hlmBtn
                type="button"
                variant="outline"
                class="min-h-11 rounded-xl"
                [disabled]="loggingOut()"
                (click)="logout()"
              >
                {{ loggingOut() ? "กำลังออกจากระบบ..." : "ออกจากระบบ" }}
              </button>
            } @else {
              <span class="hidden text-sm text-muted-foreground sm:inline"
                >ระบบสั่งอาหารผ่าน QR</span
              >
            }
          </div>
        </header>
      }

      <div
        [class]="
          staffWorkspace()
            ? sidebarCollapsed()
              ? 'grid min-w-0 flex-1 lg:grid-cols-[72px_minmax(0,1fr)]'
              : 'grid min-w-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)]'
            : 'min-w-0 flex-1'
        "
      >
        @if (staffWorkspace()) {
          <aside
            class="hidden min-w-0 bg-card lg:block"
            [class.p-2]="sidebarCollapsed()"
            [class.p-4]="!sidebarCollapsed()"
            aria-label="พื้นที่ทำงาน"
          >
            <div
              class="sticky top-4 grid max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto"
            >
              <button
                hlmBtn
                variant="ghost"
                size="icon"
                type="button"
                [attr.aria-label]="sidebarCollapsed() ? 'ขยายแถบเมนู' : 'ยุบแถบเมนู'"
                [attr.aria-expanded]="!sidebarCollapsed()"
                aria-controls="portal-desktop-navigation"
                (click)="sidebarCollapsed.set(!sidebarCollapsed())"
              >
                <ng-icon
                  [name]="sidebarCollapsed() ? 'lucidePanelLeftOpen' : 'lucidePanelLeftClose'"
                  aria-hidden="true"
                />
              </button>
              <rcat-portal-workspace-nav
                id="portal-desktop-navigation"
                [url]="url()"
                [rail]="sidebarCollapsed()"
              />
            </div>
          </aside>
          <hlm-sheet
            class="lg:hidden"
            side="left"
            [state]="mobileNavOpen() ? 'open' : 'closed'"
            (stateChanged)="mobileNavOpen.set($event === 'open')"
          >
            <hlm-sheet-content
              *hlmSheetPortal
              id="portal-mobile-navigation"
              class="flex h-dvh w-[min(90vw,360px)] flex-col overflow-hidden border-r border-border bg-card p-0 text-foreground shadow-xl lg:hidden"
              [showCloseButton]="true"
              closeLabel="ปิดเมนู"
            >
              <hlm-sheet-header class="border-b border-border px-5 py-5">
                <h2 hlmSheetTitle>เมนูจัดการร้าน</h2>
              </hlm-sheet-header>
              <div class="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                <rcat-portal-workspace-nav [url]="url()" />
              </div>
            </hlm-sheet-content>
          </hlm-sheet>
        }
        <main
          id="main"
          tabindex="-1"
          [class]="
            staffWorkspace()
              ? 'min-w-0 w-full max-w-screen-2xl px-4 py-4 sm:px-6 lg:px-8 lg:py-6'
              : 'min-w-0 w-full'
          "
        >
          @if (session.notice()) {
            <p
              class="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
              role="status"
            >
              {{ session.notice() }}
            </p>
          }
          @if (message()) {
            <p
              class="mb-4 rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm text-foreground"
              role="alert"
            >
              {{ message() }}
            </p>
          }
          <router-outlet />
        </main>
      </div>

      @if (staffWorkspace()) {
        <div class="sticky bottom-0 z-20 lg:hidden">
          <rcat-portal-workspace-nav
            [url]="url()"
            [compact]="true"
            (more)="mobileNavOpen.set(true)"
          />
        </div>
      }
      <footer
        class="border-t border-border bg-card px-4 py-4 text-center text-xs leading-5 text-muted-foreground"
      >
        RCAT POS · สั่งอาหารผ่าน QR · ชำระเงินกับร้านค้าที่เปิดรับพร้อมเพย์
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
  readonly sidebarCollapsed = signal(false);
  readonly message = signal("");
  readonly guestOrder = computed(() =>
    /^\/order(?:\/|\?|#|$)/.test(this.url()),
  );
  readonly guestMenu = computed(() => /^\/order(?:\?|#|$)/.test(this.url()));
  readonly staffWorkspace = computed(
    () => this.session.phase() === "staff" && !this.guestOrder(),
  );

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.url.set(event.urlAfterRedirects);
        this.mobileNavOpen.set(false);
      }
    });
    void this.session.ensure();
  }

  toggleMobileNav(): void {
    this.mobileNavOpen.update((open) => !open);
  }

  async logout(): Promise<void> {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    this.message.set("");
    try {
      await this.session.logout();
      this.mobileNavOpen.set(false);
      await this.router.navigateByUrl("/");
    } catch {
      this.message.set("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      this.loggingOut.set(false);
    }
  }
}
