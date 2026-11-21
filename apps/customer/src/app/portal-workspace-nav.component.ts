import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from "@angular/core";
import { Router, RouterLink, RouterLinkActive } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideLayoutDashboard,
  lucideReceiptText,
  lucidePackage,
  lucideQrCode,
  lucideBoxes,
  lucideChartNoAxesCombined,
  lucideUsers,
  lucideWallet,
  lucideClipboardCheck,
  lucideSettings,
  lucideEllipsis,
} from "@ng-icons/lucide";
import { HlmNativeSelect } from "@spartan-ng/helm/native-select";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { PortalSession } from "./portal-session.service";
import { permitsRoute } from "./portal-permissions";

/**
 * Shared desktop/sidebar and mobile Sheet menu.
 * Route permissions come from the existing server-provided PortalSession;
 * this is a presentation-only extraction, not an authorization bypass.
 */
@Component({
  selector: "rcat-portal-workspace-nav",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    provideIcons({
      lucideLayoutDashboard,
      lucideReceiptText,
      lucidePackage,
      lucideQrCode,
      lucideBoxes,
      lucideChartNoAxesCombined,
      lucideUsers,
      lucideWallet,
      lucideClipboardCheck,
      lucideSettings,
      lucideEllipsis,
    }),
  ],
  imports: [
    NgIcon,
    RouterLink,
    RouterLinkActive,
    HlmNativeSelect,
    HlmBadge,
    HlmSeparator,
  ],
  host: { class: "block min-w-0" },
  template: `
    @if (compact()) {
      <nav
        aria-label="งานที่ใช้บ่อย"
        class="grid grid-flow-col auto-cols-[minmax(0,1fr)] items-stretch gap-1 border-t border-border bg-card px-2 py-2"
      >
        @if (store(); as selected) {
          @for (item of quickMenu; track item.path) {
            @if (allowed(item.path)) {
              <a
                [routerLink]="[
                  '/',
                  item.path,
                  selected.tenantId,
                  selected.storeId,
                ]"
                routerLinkActive="bg-accent text-accent-foreground font-semibold"
                class="flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-xs font-medium text-muted-foreground no-underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ng-icon
                  [name]="item.icon"
                  class="text-lg"
                  aria-hidden="true"
                />
                <span>{{ item.label }}</span>
              </a>
            }
          }
        }
        @if (
          !store() &&
          (session.platformRole() === "super_admin" ||
            session.platformRole() === "admin")
        ) {
          <a
            routerLink="/platform"
            routerLinkActive="bg-accent text-accent-foreground font-semibold"
            class="flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-xs font-medium text-muted-foreground no-underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ng-icon name="lucideUsers" class="text-lg" aria-hidden="true" />
            ผู้ใช้งาน
          </a>
        }
        <button
          type="button"
          class="flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border-0 bg-card px-1 text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          (click)="more.emit()"
        >
          <ng-icon name="lucideEllipsis" class="text-lg" aria-hidden="true" />
          เพิ่มเติม
        </button>
      </nav>
    } @else {
      <div class="grid min-w-0 gap-4">
        @if (!rail()) {
          <section
            class="grid gap-3 rounded-xl border border-border bg-card p-4"
            aria-label="ร้านที่กำลังทำงาน"
          >
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-sm font-semibold text-foreground">พื้นที่ทำงาน</h2>
              <span hlmBadge variant="secondary">RCAT POS</span>
            </div>
            @if (store(); as selected) {
              <label
                for="portal-store"
                class="text-sm font-medium text-muted-foreground"
              >
                ร้านที่กำลังทำงาน
              </label>
              <hlm-native-select
                selectId="portal-store"
                class="block w-full"
                [value]="selected.tenantId + '|' + selected.storeId"
                (valueChange)="changeStore($event)"
              >
                @for (
                  item of session.stores();
                  track item.tenantId + item.storeId
                ) {
                  <option [value]="item.tenantId + '|' + item.storeId">
                    {{ item.storeName }}
                  </option>
                }
              </hlm-native-select>
              <p
                class="min-w-0 break-words text-sm leading-6 text-muted-foreground"
              >
                {{ selected.tenantName }}
              </p>
            } @else {
              <p class="text-sm leading-6 text-muted-foreground">
                ยังไม่มีร้านค้าที่เข้าถึงได้
              </p>
            }
          </section>
        }

        <nav aria-label="งานของร้าน" class="grid gap-3">
          <section class="grid gap-1" aria-label="ภาพรวม">
            <h3
              class="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground"
              [class.sr-only]="rail()"
            >
              ภาพรวม
            </h3>
            <a
              routerLink="/"
              routerLinkActive="bg-accent text-accent-foreground font-semibold"
              [routerLinkActiveOptions]="{ exact: true }"
              class="flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-none no-underline hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              [class.justify-center]="rail()"
              [attr.title]="rail() ? 'พื้นที่ทำงาน' : null"
            >
              <ng-icon
                name="lucideLayoutDashboard"
                class="shrink-0 text-lg"
                aria-hidden="true"
              />
              <span [class.sr-only]="rail()">พื้นที่ทำงาน</span>
            </a>
          </section>

          @if (store(); as selected) {
            <section class="grid gap-1" aria-label="งานประจำวัน">
              <h3
                class="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground"
                [class.sr-only]="rail()"
              >
                งานประจำวัน
              </h3>
              @for (item of dailyMenu; track item.path) {
                @if (allowed(item.path)) {
                  <a
                    [routerLink]="[
                      '/',
                      item.path,
                      selected.tenantId,
                      selected.storeId,
                    ]"
                    routerLinkActive="bg-accent text-accent-foreground font-semibold"
                    class="flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-none no-underline hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    [class.justify-center]="rail()"
                    [attr.title]="rail() ? item.label : null"
                  >
                    <ng-icon
                      [name]="item.icon"
                      class="shrink-0 text-lg"
                      aria-hidden="true"
                    />
                    <span [class.sr-only]="rail()">{{ item.label }}</span>
                  </a>
                }
              }
            </section>

            <section class="grid gap-1" aria-label="จัดการร้าน">
              <h3
                class="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground"
                [class.sr-only]="rail()"
              >
                จัดการร้าน
              </h3>
              @for (item of manageMenu; track item.path) {
                @if (allowed(item.path)) {
                  <a
                    [routerLink]="[
                      '/',
                      item.path,
                      selected.tenantId,
                      selected.storeId,
                    ]"
                    routerLinkActive="bg-accent text-accent-foreground font-semibold"
                    class="flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-none no-underline hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    [class.justify-center]="rail()"
                    [attr.title]="rail() ? item.label : null"
                  >
                    <ng-icon
                      [name]="item.icon"
                      class="shrink-0 text-lg"
                      aria-hidden="true"
                    />
                    <span [class.sr-only]="rail()">{{ item.label }}</span>
                  </a>
                }
              }
              @if (selected.role === "owner") {
                <a
                  [routerLink]="['/tenants', selected.tenantId, 'staff']"
                  routerLinkActive="bg-accent text-accent-foreground font-semibold"
                  class="flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-none no-underline hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  [class.justify-center]="rail()"
                  [attr.title]="rail() ? 'พนักงานและสิทธิ์' : null"
                >
                  <ng-icon
                    name="lucideUsers"
                    class="shrink-0 text-lg"
                    aria-hidden="true"
                  />
                  <span [class.sr-only]="rail()">พนักงานและสิทธิ์</span>
                </a>
              }
            </section>

            @if (selected.role === "owner" || selected.role === "manager") {
              <section class="grid gap-1" aria-label="รับชำระเงิน">
                <h3
                  class="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground"
                  [class.sr-only]="rail()"
                >
                  รับชำระเงิน
                </h3>
                <a
                  [routerLink]="[
                    '/payments/receiver',
                    selected.tenantId,
                    selected.storeId,
                  ]"
                  routerLinkActive="bg-accent text-accent-foreground font-semibold"
                  class="flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-none no-underline hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  [class.justify-center]="rail()"
                  [attr.title]="rail() ? 'บัญชีพร้อมเพย์ของร้าน' : null"
                >
                  <ng-icon
                    name="lucideWallet"
                    class="shrink-0 text-lg"
                    aria-hidden="true"
                  />
                  <span [class.sr-only]="rail()">บัญชีพร้อมเพย์ของร้าน</span>
                </a>
                <a
                  [routerLink]="[
                    '/payments',
                    selected.tenantId,
                    selected.storeId,
                  ]"
                  routerLinkActive="bg-accent text-accent-foreground font-semibold"
                  class="flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-none no-underline hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  [class.justify-center]="rail()"
                  [attr.title]="rail() ? 'ตรวจสอบสลิป' : null"
                >
                  <ng-icon
                    name="lucideClipboardCheck"
                    class="shrink-0 text-lg"
                    aria-hidden="true"
                  />
                  <span [class.sr-only]="rail()">ตรวจสอบสลิป</span>
                </a>
                <a
                  [routerLink]="[
                    '/payments/finance',
                    selected.tenantId,
                    selected.storeId,
                  ]"
                  routerLinkActive="bg-accent text-accent-foreground font-semibold"
                  class="flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-none no-underline hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  [class.justify-center]="rail()"
                  [attr.title]="rail() ? 'รายงานรับเงินและคืนเงิน' : null"
                >
                  <ng-icon
                    name="lucideChartNoAxesCombined"
                    class="shrink-0 text-lg"
                    aria-hidden="true"
                  />
                  <span [class.sr-only]="rail()">รายงานรับเงินและคืนเงิน</span>
                </a>
              </section>
            }
          }

          @if (
            session.platformRole() === "super_admin" ||
            session.platformRole() === "admin"
          ) {
            <section class="grid gap-1" aria-label="ผู้ดูแลระบบ">
              <h3
                class="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground"
                [class.sr-only]="rail()"
              >
                ผู้ดูแลระบบ
              </h3>
              <a
                routerLink="/platform"
                routerLinkActive="bg-accent text-accent-foreground font-semibold"
                class="flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-none no-underline hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                [class.justify-center]="rail()"
                [attr.title]="rail() ? 'จัดการผู้ใช้งาน' : null"
              >
                <ng-icon
                  name="lucideUsers"
                  class="shrink-0 text-lg"
                  aria-hidden="true"
                />
                <span [class.sr-only]="rail()">จัดการผู้ใช้งาน</span>
              </a>
            </section>
          }

          @if (canSetUp()) {
            <section class="grid gap-1" aria-label="ตั้งค่า">
              <h3
                class="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground"
                [class.sr-only]="rail()"
              >
                ตั้งค่า
              </h3>
              <a
                routerLink="/settings"
                routerLinkActive="bg-accent text-accent-foreground font-semibold"
                class="flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-none no-underline hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                [class.justify-center]="rail()"
                [attr.title]="rail() ? 'ตั้งค่าร้าน' : null"
              >
                <ng-icon
                  name="lucideSettings"
                  class="shrink-0 text-lg"
                  aria-hidden="true"
                />
                <span [class.sr-only]="rail()">ตั้งค่าร้าน</span>
              </a>
            </section>
          }
        </nav>
        <hlm-separator />
        @if (!rail()) {
          <p class="px-3 pb-2 text-xs leading-5 text-muted-foreground">
            เมนูแสดงตามสิทธิ์ที่ได้รับจากระบบ
          </p>
        }
      </div>
    }
  `,
})
export class PortalWorkspaceNavComponent {
  readonly session = inject(PortalSession);
  private readonly router = inject(Router);
  readonly url = input.required<string>();
  readonly compact = input(false);
  readonly rail = input(false);
  readonly more = output<void>();
  readonly quickMenu = [
    { path: "orders", label: "ออเดอร์", icon: "lucideReceiptText" },
    { path: "catalog", label: "สินค้า", icon: "lucidePackage" },
    { path: "tables", label: "โต๊ะและ QR", icon: "lucideQrCode" },
  ];
  readonly store = computed(() => {
    const segments = this.url().split(/[/?#]/);
    return (
      this.session.stores().find((item) => segments.includes(item.storeId)) ??
      this.session.stores().find((item) => segments.includes(item.tenantId)) ??
      this.session.stores()[0]
    );
  });
  readonly dailyMenu = [
    { path: "orders", label: "ออเดอร์", icon: "lucideReceiptText" },
  ];
  readonly manageMenu = [
    { path: "tables", label: "โต๊ะและ QR", icon: "lucideQrCode" },
    { path: "catalog", label: "เมนูและราคา", icon: "lucidePackage" },
    { path: "inventory", label: "สต็อกและวัตถุดิบ", icon: "lucideBoxes" },
    { path: "reports", label: "รายงาน", icon: "lucideChartNoAxesCombined" },
  ];

  allowed(kind: string): boolean {
    const store = this.store();
    return (
      !!store &&
      permitsRoute(this.session.stores(), kind, store.tenantId, store.storeId)
    );
  }

  canSetUp(): boolean {
    return (
      this.session.platformRole() === "super_admin" ||
      this.session.platformRole() === "admin" ||
      this.session.stores().some((store) => store.role === "owner")
    );
  }

  changeStore(value: string | undefined | null): void {
    const selected = this.session
      .stores()
      .find((store) => store.tenantId + "|" + store.storeId === value);
    if (selected) {
      void this.router.navigate([
        "/orders",
        selected.tenantId,
        selected.storeId,
      ]);
    }
  }
}
