import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
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
import {
  IssuedTableCode,
  MerchantTablesApi,
  PrintableTable,
} from "./merchant-tables.api";

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
          QR ที่พิมพ์ติดโต๊ะระบุเพียงร้านและโต๊ะ ไม่ได้ให้สิทธิ์สั่งอาหารทันที
          ลูกค้าต้องกรอกรหัส 8 หลักที่พนักงานออกให้สำหรับรอบโต๊ะนั้น
        </p>
        <p class="tables-warning">
          <strong>ไม่ใช่ QR รับเงิน PromptPay</strong>
          รหัสโต๊ะต้องแจ้งให้ลูกค้าทราบแยกต่างหาก ห้ามพิมพ์รหัสลงใน QR ถาวร
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
          <h2 id="table-selection">เลือกโต๊ะเพื่อพิมพ์ QR หรือออกโค้ดใหม่</h2>
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
                <p>QR ถาวร · สแกนแล้วกรอกรหัสรอบโต๊ะ</p>
              </div>
              <div class="table-actions">
                <button type="button" [disabled]="busy()" (click)="print()">
                  พิมพ์ QR ของโต๊ะนี้
                </button>
                <button type="button" [disabled]="busy()" (click)="issueCode()">
                  ออกรหัสโต๊ะใหม่
                </button>
              </div>
            </div>
            <img
              class="table-qr"
              [src]="qrSrc(table.tableId)"
              [alt]="'QR สำหรับสั่งอาหาร ' + table.label"
            />
            <p class="table-url">{{ table.printedUrl }}</p>
            @if (latestCode(); as issued) {
              <div class="table-code" role="status">
                <p>รหัสรอบโต๊ะล่าสุด (แสดงเฉพาะในหน้านี้)</p>
                <strong>{{ issued.code }}</strong>
                <p>หมดอายุ: {{ issued.expiresAt }}</p>
                <p>
                  การออกรหัสใหม่จะยกเลิกรหัสรอบก่อนและสิทธิ์สั่งอาหารเดิม
                  แต่ไม่ลบออเดอร์ที่บันทึกไปแล้ว
                </p>
              </div>
            } @else {
              <p class="tables-warning">
                หากไม่มีรหัสรอบโต๊ะที่ใช้งานอยู่ ให้กด “ออกรหัสโต๊ะใหม่”
                แล้วแจ้งรหัสแก่ลูกค้าที่นั่งโต๊ะนั้น
              </p>
            }
            <div class="print-sheet" aria-hidden="true">
              <h2>RCAT POS · {{ table.label }}</h2>
              <img [src]="qrSrc(table.tableId)" alt="" />
              <p>สแกนเพื่อเปิดเมนู จากนั้นกรอกรหัส 8 หลักที่พนักงานแจ้ง</p>
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
  readonly latestCode = signal<IssuedTableCode | null>(null);
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
    if (!data.tables.some((table) => table.tableId === this.selectedId())) {
      this.selectedId.set(data.tables[0]?.tableId ?? null);
    }
  }
  qrSrc(tableId: string): string {
    return this.api.qrUrl(this.tenant, this.store, tableId);
  }
  select(table: PrintableTable): void {
    this.selectedId.set(table.tableId);
    this.latestCode.set(null);
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
      this.latestCode.set(null);
      this.notice.set("เพิ่มโต๊ะแล้ว สามารถพิมพ์ QR ถาวรและออกรหัสรอบโต๊ะได้");
    } catch {
      this.error.set("เพิ่มโต๊ะไม่สำเร็จ ตรวจสอบชื่อโต๊ะว่าซ้ำหรือไม่");
    } finally {
      this.busy.set(false);
    }
  }
  async issueCode(): Promise<void> {
    const table = this.selected();
    if (!table || this.busy()) return;
    const approved = this.document.defaultView?.confirm(
      "ออกรหัสใหม่สำหรับ " +
        table.label +
        " ? การสั่งอาหารด้วยรหัส/Token รอบก่อนจะถูกยกเลิก แต่ Order เดิมไม่ถูกลบ",
    );
    if (!approved) return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    this.latestCode.set(null);
    try {
      const data = await this.api.issueCode(
        this.tenant,
        this.store,
        table.tableId,
      );
      await this.refresh();
      this.latestCode.set(data);
      this.notice.set("ออกรหัสใหม่แล้ว ให้แจ้งรหัสแก่ลูกค้าที่นั่งโต๊ะ");
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse && error.status === 503
          ? "ยังไม่ได้กำหนดค่าระบบรหัสโต๊ะบนเซิร์ฟเวอร์"
          : "ไม่สามารถออกรหัสใหม่ได้ กรุณาตรวจสอบสิทธิ์แล้วลองใหม่",
      );
    } finally {
      this.busy.set(false);
    }
  }
  print(): void {
    this.document.defaultView?.print();
  }
}
