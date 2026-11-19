import { DOCUMENT } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmCard } from "@spartan-ng/helm/card";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmLabel } from "@spartan-ng/helm/label";
import { MerchantOrderApi } from "./merchant-order.api";
import { MerchantTablesApi, PrintableTable } from "./merchant-tables.api";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    HlmBadge,
    HlmButton,
    HlmCard,
    HlmInput,
    HlmLabel,
  ],
  styleUrls: ["./merchant-tables.css"],
  template: `
    <section
      class="tables-shell mx-auto box-border w-full max-w-6xl space-y-5 px-4 pb-14 pt-6 sm:px-6 lg:px-8"
      aria-labelledby="tables-title"
    >
      <header class="space-y-3 border-b border-border pb-5">
        <a hlmBtn routerLink="/" variant="link" class="min-h-11 px-0">
          ← กลับหน้าร้านค้า
        </a>
        <p
          class="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
        >
          ORDERING / TABLE QR
        </p>
        <h1
          id="tables-title"
          class="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          QR สั่งอาหารติดโต๊ะ
        </h1>
        <p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
          ใช้ QR ติดโต๊ะเดิมได้ตลอด ลูกค้าสแกนเพื่อเปิดเมนูและสั่งอาหารได้ทันที
          เมื่อร้านเปิดรับออเดอร์
        </p>
        <p
          class="max-w-prose rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed"
        >
          <strong class="font-semibold">ไม่ใช่ QR รับเงิน PromptPay</strong>
          ร้านควบคุมการรับออเดอร์ผ่านปุ่มด้านล่าง ไม่ต้องออกรหัส 8 หลัก
        </p>
      </header>

      @if (loading()) {
        <p
          class="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"
          role="status"
        >
          กำลังตรวจสิทธิ์และรายการโต๊ะ...
        </p>
      } @else if (!authorized()) {
        <p
          class="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          {{ error() || "บัญชีนี้ไม่มีสิทธิ์จัดการโต๊ะ" }}
        </p>
      } @else {
        @if (error()) {
          <p
            class="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            role="alert"
          >
            {{ error() }}
          </p>
        }
        @if (notice()) {
          <p
            class="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed"
            role="status"
          >
            {{ notice() }}
          </p>
        }

        <section
          hlmCard
          size="sm"
          class="min-w-0 gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
          aria-labelledby="ordering-switch-title"
        >
          <div class="min-w-0 space-y-2">
            <h2 id="ordering-switch-title" class="text-lg font-semibold">
              เปิดรับออเดอร์ผ่าน QR
            </h2>
            <span
              hlmBadge
              [variant]="orderingEnabled() ? 'secondary' : 'outline'"
            >
              {{ orderingEnabled() ? "เปิดรับออเดอร์" : "ปิดรับออเดอร์" }}
            </span>
            <p class="text-sm leading-relaxed text-muted-foreground">
              {{
                orderingEnabled()
                  ? "เปิดอยู่ · ลูกค้าสแกน QR เพื่อสั่งได้ทันที"
                  : "ปิดอยู่ · ลูกค้าเห็นข้อความว่าร้านยังไม่เปิดให้สั่ง"
              }}
            </p>
          </div>
          <button
            hlmBtn
            type="button"
            class="min-h-11 w-full shrink-0 sm:w-auto"
            [variant]="orderingEnabled() ? 'destructive' : 'default'"
            [disabled]="busy()"
            [attr.aria-pressed]="orderingEnabled()"
            (click)="toggleOrdering()"
          >
            {{
              busy()
                ? "กำลังบันทึก..."
                : orderingEnabled()
                  ? "ปิดรับออเดอร์"
                  : "เปิดรับออเดอร์"
            }}
          </button>
        </section>

        <form
          hlmCard
          size="sm"
          class="min-w-0 gap-4 p-4 sm:p-5"
          (ngSubmit)="createTable()"
        >
          <h2 class="text-lg font-semibold">เพิ่มโต๊ะใหม่</h2>
          <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
            <div class="grid min-w-0 flex-1 gap-2">
              <label hlmLabel for="table-label">ชื่อโต๊ะ</label>
              <input
                hlmInput
                id="table-label"
                class="min-h-11 w-full"
                name="tableLabel"
                [(ngModel)]="newLabel"
                maxlength="60"
                required
                placeholder="เช่น โต๊ะ 1"
                [disabled]="busy()"
              />
            </div>
            <button hlmBtn type="submit" class="min-h-11" [disabled]="busy()">
              เพิ่มโต๊ะ
            </button>
          </div>
        </form>

        <section
          hlmCard
          size="sm"
          class="min-w-0 gap-4 p-4 sm:p-5"
          aria-labelledby="table-selection"
        >
          <h2 id="table-selection" class="text-lg font-semibold">
            เลือกโต๊ะเพื่อดูหรือพิมพ์ QR เดิม
          </h2>
          <div
            class="tables-grid grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            @for (table of tables(); track table.tableId) {
              <article
                hlmCard
                size="sm"
                class="table-card min-w-0 gap-3 p-4"
                [class.ring-2]="selectedId() === table.tableId"
                [class.ring-primary]="selectedId() === table.tableId"
              >
                <h3 class="break-words font-semibold">{{ table.label }}</h3>
                <span
                  hlmBadge
                  class="w-fit"
                  [variant]="table.active ? 'secondary' : 'outline'"
                >
                  {{ table.active ? "ใช้งานอยู่" : "ปิดใช้งาน" }}
                </span>
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  class="min-h-11"
                  [disabled]="busy() || !table.active"
                  [attr.aria-pressed]="selectedId() === table.tableId"
                  (click)="select(table)"
                >
                  เลือกโต๊ะนี้
                </button>
              </article>
            } @empty {
              <p
                class="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground"
                role="status"
              >
                ยังไม่มีโต๊ะ กรุณาเพิ่มโต๊ะใหม่
              </p>
            }
          </div>
        </section>

        @if (selected(); as table) {
          <section
            hlmCard
            size="sm"
            class="table-work min-w-0 gap-4 p-4 sm:p-5"
            aria-labelledby="table-work-title"
          >
            <div
              class="flex min-w-0 flex-wrap items-center justify-between gap-3"
            >
              <div class="min-w-0 space-y-1">
                <h2
                  id="table-work-title"
                  class="break-words text-lg font-semibold"
                >
                  {{ table.label }}
                </h2>
                <p class="text-sm leading-relaxed text-muted-foreground">
                  QR ถาวร · สแกนเพื่อสั่งเมื่อร้านเปิดรับออเดอร์
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  hlmBtn
                  type="button"
                  class="min-h-11"
                  [disabled]="busy()"
                  (click)="print()"
                >
                  พิมพ์ QR ของโต๊ะนี้
                </button>
              </div>
            </div>
            <img
              class="table-qr mx-auto my-4 aspect-square w-full max-w-xs rounded-xl border border-border bg-white p-3 object-contain"
              [src]="qrSrc(table.tableId)"
              [alt]="'QR สำหรับสั่งอาหาร ' + table.label"
            />
            <p
              class="break-all text-center text-sm leading-relaxed text-muted-foreground"
            >
              {{ table.printedUrl }}
            </p>
            <div class="print-sheet hidden" aria-hidden="true">
              <h2>RCAT POS · {{ table.label }}</h2>
              <img [src]="qrSrc(table.tableId)" alt="" />
              <p>สแกนเพื่อสั่งอาหาร เมื่อร้านเปิดรับออเดอร์</p>
              <strong>QR สั่งอาหารเท่านั้น · ไม่ใช่ QR ชำระเงิน</strong>
            </div>
          </section>
        }
      }
    </section>
  `,
})
export class MerchantTablesPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly orders = inject(MerchantOrderApi);
  private readonly api = inject(MerchantTablesApi);
  private readonly document = inject(DOCUMENT);
  readonly loading = signal(true);
  readonly authorized = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly tables = signal<PrintableTable[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly orderingEnabled = signal(false);
  readonly selected = computed(
    () =>
      this.tables().find((table) => table.tableId === this.selectedId()) ??
      null,
  );
  newLabel = "";

  private get tenant(): string {
    return this.route.snapshot.paramMap.get("tenantId") ?? "";
  }
  private get store(): string {
    return this.route.snapshot.paramMap.get("storeId") ?? "";
  }
  ngOnInit(): void {
    void this.initialize();
  }
  private async initialize(): Promise<void> {
    this.loading.set(true);
    try {
      const { stores } = await this.orders.stores();
      this.authorized.set(
        stores.some(
          (s) =>
            s.tenantId === this.tenant &&
            s.storeId === this.store &&
            (s.role === "owner" || s.role === "manager"),
        ),
      );
      if (!this.authorized()) {
        this.error.set("ต้องมีสิทธิ์เจ้าของร้านหรือผู้จัดการ");
        return;
      }
      await this.refresh();
    } catch {
      this.error.set("กรุณาเข้าสู่ระบบอีกครั้ง");
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    const data = await this.api.list(this.tenant, this.store);
    this.tables.set(data.tables);
    this.orderingEnabled.set(data.orderingEnabled);
    if (!data.tables.some((table) => table.tableId === this.selectedId())) {
      this.selectedId.set(data.tables[0]?.tableId ?? null);
    }
  }
  qrSrc(tableId: string): string {
    return this.api.qrUrl(this.tenant, this.store, tableId);
  }
  select(table: PrintableTable): void {
    this.selectedId.set(table.tableId);
    this.error.set("");
    this.notice.set("");
  }
  async createTable(): Promise<void> {
    if (!this.newLabel.trim() || this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const data = await this.api.add(
        this.tenant,
        this.store,
        this.newLabel.trim(),
      );
      this.newLabel = "";
      await this.refresh();
      this.selectedId.set(data.tableId);
      this.notice.set("เพิ่มโต๊ะแล้ว สามารถพิมพ์ QR ถาวรได้ทันที");
    } catch {
      this.error.set("เพิ่มโต๊ะไม่สำเร็จ ตรวจสอบชื่อโต๊ะว่าซ้ำหรือไม่");
    } finally {
      this.busy.set(false);
    }
  }
  async toggleOrdering(): Promise<void> {
    if (this.busy()) return;
    const next = !this.orderingEnabled();
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      const result = await this.api.setOrderingEnabled(
        this.tenant,
        this.store,
        next,
      );
      this.orderingEnabled.set(result.orderingEnabled);
      this.notice.set(
        result.orderingEnabled
          ? "เปิดรับออเดอร์แล้ว ลูกค้าสแกน QR เดิมเพื่อสั่งได้"
          : "ปิดรับออเดอร์แล้ว จะไม่มีออเดอร์ใหม่เข้าระบบ",
      );
    } catch {
      this.error.set("ไม่สามารถเปลี่ยนสถานะรับออเดอร์ได้ กรุณาลองอีกครั้ง");
    } finally {
      this.busy.set(false);
    }
  }
  print(): void {
    this.document.defaultView?.print();
  }
}
