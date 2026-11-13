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
import { MerchantOrderApi } from "./merchant-order.api";
import { MerchantTablesApi, PrintableTable } from "./merchant-tables.api";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  styleUrls: ["./merchant-tables.css"],
  template: `
    <section class="tables-shell" aria-labelledby="tables-title">
      <header class="tables-header">
        <a routerLink="/">← กลับหน้าร้านค้า</a>
        <span class="eyebrow">ORDERING / TABLE QR</span>
        <h1 id="tables-title">QR สั่งอาหารติดโต๊ะ</h1>
        <p>
          ใช้ QR ติดโต๊ะเดิมได้ตลอด ลูกค้าสแกนเพื่อเปิดเมนูและสั่งอาหารได้ทันที
          เมื่อร้านเปิดรับออเดอร์
        </p>
        <p class="tables-warning">
          <strong>ไม่ใช่ QR รับเงิน PromptPay</strong>
          ร้านควบคุมการรับออเดอร์ผ่านสวิตช์ด้านล่าง ไม่ต้องออกรหัส 8 หลัก
        </p>
      </header>
      @if (loading()) {
        <p role="status">กำลังตรวจสิทธิ์และรายการโต๊ะ...</p>
      } @else if (!authorized()) {
        <p role="alert">{{ error() || "บัญชีนี้ไม่มีสิทธิ์จัดการโต๊ะ" }}</p>
      } @else {
        @if (error()) {
          <p class="tables-error" role="alert">{{ error() }}</p>
        }
        @if (notice()) {
          <p class="tables-notice" role="status">{{ notice() }}</p>
        }
        <section
          class="ordering-switch"
          aria-labelledby="ordering-switch-title"
        >
          <div>
            <h2 id="ordering-switch-title">เปิดรับออเดอร์ผ่าน QR</h2>
            <p>
              {{
                orderingEnabled()
                  ? "เปิดอยู่ · ลูกค้าสแกน QR เพื่อสั่งได้ทันที"
                  : "ปิดอยู่ · ลูกค้าเห็นข้อความว่าร้านยังไม่เปิดให้สั่ง"
              }}
            </p>
          </div>
          <button
            type="button"
            [class.is-open]="orderingEnabled()"
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
        <form class="tables-add" (ngSubmit)="createTable()">
          <h2>เพิ่มโต๊ะใหม่</h2>
          <label for="table-label">ชื่อโต๊ะ</label>
          <input
            id="table-label"
            name="tableLabel"
            [(ngModel)]="newLabel"
            maxlength="60"
            required
            placeholder="เช่น โต๊ะ 1"
            [disabled]="busy()"
          />
          <button type="submit" [disabled]="busy()">เพิ่มโต๊ะ</button>
        </form>
        <section class="tables-list" aria-labelledby="table-selection">
          <h2 id="table-selection">เลือกโต๊ะเพื่อดูหรือพิมพ์ QR เดิม</h2>
          <div class="tables-grid">
            @for (table of tables(); track table.tableId) {
              <article
                class="table-card"
                [class.selected]="selectedId() === table.tableId"
              >
                <h3>{{ table.label }}</h3>
                <p>{{ table.active ? "ใช้งานอยู่" : "ปิดใช้งาน" }}</p>
                <button
                  type="button"
                  [disabled]="busy() || !table.active"
                  (click)="select(table)"
                >
                  เลือกโต๊ะนี้
                </button>
              </article>
            } @empty {
              <p role="status">ยังไม่มีโต๊ะ กรุณาเพิ่มโต๊ะใหม่</p>
            }
          </div>
        </section>
        @if (selected(); as table) {
          <section class="table-work" aria-labelledby="table-work-title">
            <div class="table-work-head">
              <div>
                <h2 id="table-work-title">{{ table.label }}</h2>
                <p>QR ถาวร · สแกนเพื่อสั่งเมื่อร้านเปิดรับออเดอร์</p>
              </div>
              <div class="table-actions">
                <button type="button" [disabled]="busy()" (click)="print()">
                  พิมพ์ QR ของโต๊ะนี้
                </button>
              </div>
            </div>
            <img
              class="table-qr"
              [src]="qrSrc(table.tableId)"
              [alt]="'QR สำหรับสั่งอาหาร ' + table.label"
            />
            <p class="table-url">{{ table.printedUrl }}</p>
            <div class="print-sheet" aria-hidden="true">
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
