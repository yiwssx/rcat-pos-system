import { DOCUMENT } from "@angular/common";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { PortalSession } from "./portal-session.service";

type PlatformRole = "super_admin" | "admin" | "merchant";
type AssignableRole = "admin" | "merchant";
interface PlatformAccount {
  userId: string;
  email: string;
  role: PlatformRole;
  active: boolean;
}
interface PlatformTenant {
  tenantId: string;
  tenantName: string;
  storeCount: number;
}

function failure(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
    if (error.status === 403) return "ไม่มีสิทธิ์ดำเนินการตามที่เลือก";
    if (error.status === 400) return "อีเมล บทบาท หรือข้อมูลไม่ถูกต้อง";
    if (error.status === 409) return "ข้อมูลบัญชีนี้ขัดแย้งกับรายการเดิม";
  }
  return "ดำเนินการไม่สำเร็จ กรุณาลองใหม่";
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HlmButton, HlmInput],
  template: `
    <section class="platform-console mx-auto max-w-6xl min-w-0 space-y-4" aria-labelledby="platform-heading">
      <header class="platform-heading flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-brand-soft p-5">
        <div>
          <span class="platform-eyebrow text-sm font-semibold text-brand-foreground">การจัดการผู้ใช้งาน</span>
          <h1 id="platform-heading" class="m-0 max-w-none text-2xl font-semibold leading-tight sm:text-3xl">จัดการผู้ใช้งาน</h1>
          <p class="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
            เพิ่มบุคลากรด้วยอีเมล @rcat.ac.th
            แล้วกำหนดว่าใครเป็นผู้ดูแลระบบหรือผู้ดูแลร้าน
          </p>
        </div>
        <a routerLink="/" class="platform-back inline-flex min-h-11 items-center rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground no-underline">กลับหน้าหลัก</a>
      </header>

      <div class="platform-status-line flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span class="platform-role-chip rounded-lg bg-secondary px-3 py-2 font-semibold text-secondary-foreground">
          {{ isSuper() ? "Super Admin" : "Admin" }}
        </span>
        <span>การเปลี่ยนแปลงสิทธิ์ทุกครั้งมีการบันทึกประวัติ</span>
      </div>

      @if (error()) {
        <p class="platform-error rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{{ error() }}</p>
      }
      @if (notice()) {
        <p class="platform-success rounded-xl bg-served p-4 text-sm text-served-foreground" role="status">{{ notice() }}</p>
      }
      @if (loading()) {
        <p role="status" class="platform-loading rounded-xl bg-card p-4 text-sm text-muted-foreground">
          กำลังโหลดรายการผู้ใช้ที่ได้รับอนุญาต…
        </p>
      }

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="สรุปบัญชีผู้ใช้งาน">
        <div class="rounded-xl bg-brand-soft p-4 text-brand-foreground"><span class="block text-sm">บัญชีทั้งหมด</span><strong class="text-2xl font-semibold tabular-nums">{{ accounts().length }}</strong></div>
        <div class="rounded-xl bg-served p-4 text-served-foreground"><span class="block text-sm">ใช้งานได้</span><strong class="text-2xl font-semibold tabular-nums">{{ activeCount() }}</strong></div>
        <div class="rounded-xl bg-muted p-4 text-muted-foreground"><span class="block text-sm">ระงับ</span><strong class="text-2xl font-semibold tabular-nums">{{ accounts().length - activeCount() }}</strong></div>
      </div>
      <div class="platform-columns grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <details #accountEditor class="platform-panel min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
          <summary class="min-h-11 cursor-pointer space-y-1 bg-muted px-4 py-3 focus-visible:outline-2 focus-visible:outline-ring">
            <strong class="block text-base font-semibold">อนุญาตบัญชีบุคลากร</strong>
            <span class="block text-sm text-muted-foreground">เพิ่ม Admin หรือ Merchant ตามสิทธิ์ผู้ดูแล</span>
          </summary>
          <div class="platform-panel-body space-y-4 p-4">
            <form (submit)="save($event)" class="platform-form grid min-w-0 gap-3 text-sm">
              <label for="platform-email">อีเมล Google Workspace</label>
              <input
                hlmInput
                class="min-h-11 w-full"
                id="platform-email"
                type="email"
                autocomplete="off"
                placeholder="staff@rcat.ac.th"
                [value]="email()"
                (input)="setEmail($event)"
                required
                maxlength="254"
              />
              <label for="platform-role">ระดับสิทธิ์</label>
              <select
                class="min-h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                id="platform-role"
                [value]="role()"
                (change)="setRole($event)"
              >
                <option value="merchant">
                  Merchant — ผู้ดูแลร้านตามที่ได้รับมอบหมาย
                </option>
                @if (isSuper()) {
                  <option value="admin">Admin — จัดการบัญชี Merchant</option>
                }
              </select>
              <button hlmBtn class="min-h-11 w-full" type="submit" [disabled]="pending()">
                {{ pending() ? "กำลังบันทึก…" : "เพิ่ม / ปรับสิทธิ์บัญชี" }}
              </button>
            </form>
            <p class="platform-hint text-sm leading-6 text-muted-foreground">
              Super Admin แต่งตั้ง Admin ได้ ส่วน Super Admin และ Admin เพิ่ม
              Merchant ได้ ไม่มีการสมัครบัญชีด้วยตนเอง
            </p>
          </div>
        </details>

        <details class="platform-panel min-w-0 overflow-hidden rounded-2xl border border-border bg-card" open>
          <summary class="min-h-11 cursor-pointer space-y-1 bg-muted px-4 py-3 focus-visible:outline-2 focus-visible:outline-ring">
            <strong class="block text-base font-semibold">บัญชีที่อนุญาตแล้ว</strong>
            <span class="block text-sm text-muted-foreground">{{ accounts().length }} บัญชี</span>
          </summary>
          <div class="platform-panel-body platform-account-list divide-y divide-border p-4">
            @for (account of accounts(); track account.userId) {
              <article class="platform-account flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
                <div class="platform-account-meta min-w-0 flex-1 space-y-1 break-all">
                  <strong class="block text-base font-semibold">{{ account.email }}</strong>
                  <span class="block text-sm text-muted-foreground"
                    >{{ label(account.role) }} ·
                    {{ account.active ? "ใช้งานได้" : "ระงับ" }}</span
                  >
                </div>
                @if (
                  account.role !== "super_admin" &&
                  (isSuper() || account.role === "merchant")
                ) {
                  <div class="platform-account-actions flex flex-wrap gap-2">
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      class="platform-subtle min-h-11"
                      (click)="accountEditor.open = true; edit(account)"
                      [disabled]="pending()"
                    >
                      แก้ไข
                    </button>
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      class="platform-subtle min-h-11"
                      (click)="setActive(account, !account.active)"
                      [disabled]="pending()"
                    >
                      {{ account.active ? "ระงับ" : "เปิดใช้งาน" }}
                    </button>
                  </div>
                }
              </article>
            } @empty {
              <p class="platform-hint text-sm leading-6 text-muted-foreground">ยังไม่พบรายการผู้ใช้</p>
            }
          </div>
        </details>
      </div>

      <details class="platform-panel platform-tenant-panel min-w-0 overflow-hidden rounded-2xl border border-border bg-card" open>
        <summary class="min-h-11 cursor-pointer space-y-1 bg-muted px-4 py-3 focus-visible:outline-2 focus-visible:outline-ring">
          <strong class="block text-base font-semibold">มอบหมายผู้ดูแลร้านค้า</strong>
          <span class="block text-sm text-muted-foreground">เลือกผู้ดูแลร้านและกลุ่มร้านค้าที่ต้องการ</span>
        </summary>
        <div class="platform-panel-body space-y-4 p-4">
          <form (submit)="assign($event)" class="platform-form platform-assign grid min-w-0 gap-3 text-sm">
            <label for="platform-merchant-email">บัญชี Merchant</label>
            <select
                class="min-h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              id="platform-merchant-email"
              [value]="merchantEmail()"
              (change)="setMerchantEmail($event)"
              required
            >
              <option value="">เลือกบัญชี Merchant</option>
              @for (account of accounts(); track account.userId) {
                @if (account.role === "merchant" && account.active) {
                  <option [value]="account.email">{{ account.email }}</option>
                }
              }
            </select>
            <label for="platform-tenant">กลุ่มร้านค้า</label>
            <select
                class="min-h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              id="platform-tenant"
              [value]="selectedTenant()"
              (change)="setTenant($event)"
              required
            >
              <option value="">เลือกกลุ่มร้านค้า</option>
              @for (tenant of tenants(); track tenant.tenantId) {
                <option [value]="tenant.tenantId">
                  {{ tenant.tenantName }} ({{ tenant.storeCount }} ร้าน)
                </option>
              }
            </select>
            <button hlmBtn class="min-h-11 w-full" type="submit" [disabled]="pending()">
              มอบหมายผู้ดูแลร้าน
            </button>
          </form>
          @if (tenants().length === 0) {
            <p class="platform-hint text-sm leading-6 text-muted-foreground">
              ยังไม่มีกลุ่มร้านค้า สร้างกลุ่มร้านค้าและร้านแรกจาก
              <a routerLink="/settings">ตั้งค่าร้านค้า</a> ก่อนมอบหมายสิทธิ์
            </p>
          }
        </div>
      </details>

      @if (isSuper()) {
        <details class="platform-panel platform-tenant-panel min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
          <summary class="min-h-11 cursor-pointer space-y-1 bg-muted px-4 py-3 focus-visible:outline-2 focus-visible:outline-ring">
            <strong class="block text-base font-semibold">เข้าจัดการร้านทุกแห่ง</strong>
            <span class="block text-sm text-muted-foreground">ระบบบันทึกประวัติการเข้าจัดการร้าน</span>
          </summary>
          <div class="platform-panel-body space-y-4 p-4">
            <p class="platform-hint text-sm leading-6 text-muted-foreground">
              เลือกกลุ่มร้านค้าที่ต้องการจัดการ ระบบจะบันทึกประวัติการเข้าถึงไว้
            </p>
            <div class="platform-tenant-list divide-y divide-border">
              @for (tenant of tenants(); track tenant.tenantId) {
                <div class="platform-tenant-row flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>{{ tenant.tenantName }}</span>
                  <button
                    hlmBtn
                    variant="outline"
                    type="button"
                    class="platform-subtle min-h-11"
                    (click)="enter(tenant)"
                    [disabled]="pending()"
                  >
                    เข้าจัดการ
                  </button>
                </div>
              }
            </div>
          </div>
        </details>
      }
    </section>
  `,
})
export class PlatformAccessPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  readonly session = inject(PortalSession);

  readonly isSuper = computed(
    () => this.session.platformRole() === "super_admin",
  );
  readonly accounts = signal<PlatformAccount[]>([]);
  readonly tenants = signal<PlatformTenant[]>([]);
  readonly activeCount = computed(() => this.accounts().filter((account) => account.active).length);
  readonly loading = signal(true);
  readonly pending = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly email = signal("");
  readonly role = signal<AssignableRole>("merchant");
  readonly merchantEmail = signal("");
  readonly selectedTenant = signal("");

  ngOnInit(): void {
    void this.load();
  }

  label(role: PlatformRole): string {
    if (role === "super_admin") return "Super Admin";
    if (role === "admin") return "Admin";
    return "Merchant";
  }

  private headers(): Record<string, string> {
    const tokens = this.document.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("__Host-rcat_csrf="));
    const token = tokens[0]?.slice("__Host-rcat_csrf=".length) ?? "";
    if (tokens.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error("Missing CSRF token");
    }
    return { "X-CSRF-Token": token };
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      const [accounts, tenants] = await Promise.all([
        firstValueFrom(
          this.http.get<{ accounts: PlatformAccount[] }>(
            "/api/platform/accounts",
          ),
        ),
        firstValueFrom(
          this.http.get<{ tenants: PlatformTenant[] }>("/api/platform/tenants"),
        ),
      ]);
      this.accounts.set(accounts.accounts);
      this.tenants.set(tenants.tenants);
    } catch (error) {
      this.error.set(failure(error));
    } finally {
      this.loading.set(false);
    }
  }

  setEmail(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
  }

  setRole(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.role.set(value === "admin" && this.isSuper() ? "admin" : "merchant");
  }

  setMerchantEmail(event: Event): void {
    this.merchantEmail.set((event.target as HTMLSelectElement).value);
  }

  setTenant(event: Event): void {
    this.selectedTenant.set((event.target as HTMLSelectElement).value);
  }

  edit(account: PlatformAccount): void {
    this.email.set(account.email);
    this.role.set(
      account.role === "admin" && this.isSuper() ? "admin" : "merchant",
    );
    this.notice.set("เลือกบัญชีแล้ว กรุณาตรวจสอบบทบาทก่อนบันทึก");
  }

  async save(event: Event): Promise<void> {
    event.preventDefault();
    const email = this.email().trim().toLowerCase();
    if (
      this.pending() ||
      !/^[^\s@]+@rcat\.ac\.th$/.test(email) ||
      (this.role() === "admin" && !this.isSuper())
    ) {
      this.error.set("ต้องเป็นอีเมล @rcat.ac.th และเลือกบทบาทที่ได้รับสิทธิ์");
      return;
    }
    this.pending.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await firstValueFrom(
        this.http.post(
          "/api/platform/accounts",
          { email, role: this.role(), active: true },
          { headers: this.headers() },
        ),
      );
      this.email.set("");
      this.role.set("merchant");
      await this.load();
      this.notice.set("บันทึกสิทธิ์บัญชีเรียบร้อยแล้ว");
    } catch (error) {
      this.error.set(failure(error));
    } finally {
      this.pending.set(false);
    }
  }

  async setActive(account: PlatformAccount, active: boolean): Promise<void> {
    if (this.pending()) return;
    if (
      !this.document.defaultView?.confirm(
        active
          ? "ยืนยันเปิดใช้งานบัญชี " + account.email + "?"
          : "ยืนยันระงับบัญชี " +
              account.email +
              " และยกเลิก Session ที่มีอยู่?",
      )
    ) {
      return;
    }
    this.pending.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await firstValueFrom(
        this.http.post(
          "/api/platform/accounts",
          { email: account.email, role: account.role, active },
          { headers: this.headers() },
        ),
      );
      await this.load();
      this.notice.set(
        active ? "เปิดใช้งานบัญชีแล้ว" : "ระงับบัญชีและเพิกถอน Session แล้ว",
      );
    } catch (error) {
      this.error.set(failure(error));
    } finally {
      this.pending.set(false);
    }
  }

  async assign(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pending() || !this.selectedTenant() || !this.merchantEmail()) {
      this.error.set("กรุณาเลือก Merchant และหน่วยงาน");
      return;
    }
    this.pending.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await firstValueFrom(
        this.http.post(
          "/api/platform/tenants/" +
            encodeURIComponent(this.selectedTenant()) +
            "/merchants",
          { email: this.merchantEmail() },
          { headers: this.headers() },
        ),
      );
      this.notice.set("มอบหมาย Merchant ให้หน่วยงานเรียบร้อยแล้ว");
    } catch (error) {
      this.error.set(failure(error));
    } finally {
      this.pending.set(false);
    }
  }

  async enter(tenant: PlatformTenant): Promise<void> {
    if (!this.isSuper() || this.pending()) return;
    if (
      !this.document.defaultView?.confirm(
        "ยืนยันเข้าจัดการ " + tenant.tenantName + " และบันทึกประวัติ?",
      )
    ) {
      return;
    }
    this.pending.set(true);
    this.error.set("");
    try {
      await firstValueFrom(
        this.http.post(
          "/api/platform/tenants/" +
            encodeURIComponent(tenant.tenantId) +
            "/enter",
          {},
          { headers: this.headers() },
        ),
      );
      await this.session.refresh();
      await this.router.navigateByUrl("/");
    } catch (error) {
      this.error.set(failure(error));
    } finally {
      this.pending.set(false);
    }
  }
}
