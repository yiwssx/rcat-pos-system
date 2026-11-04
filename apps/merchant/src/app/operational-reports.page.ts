import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MerchantStore } from "./order-board.domain";
import { MerchantOrderApi } from "./merchant-order.api";
import { OperationalReportsApi } from "./operational-reports.api";
import {
  OperationalDailyReport,
  formatReportSatang,
  formatReportSeconds,
  todayBangkok,
} from "./operational-report.domain";

const STATUS_LABEL: Record<string, string> = {
  submitted: "รอรับ",
  accepted: "รับแล้ว",
  preparing: "กำลังเตรียม",
  served: "เสิร์ฟแล้ว",
  cancelled: "ยกเลิก",
};

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrls: ["./operational-reports.css"],
  template: `
    <section class="report-shell" aria-labelledby="report-title">
      <header class="report-head">
        <div>
          <a class="report-back" routerLink="/">← กลับไปหน้าร้านค้า</a>
          <span class="eyebrow">OPERATIONS / NOT PAYMENTS</span>
          <h1 id="report-title">รายงานออเดอร์ประจำวัน</h1>
          <p class="report-lede">
            {{ store()?.storeName || "กำลังตรวจสอบสิทธิ์ร้าน" }}
            · วันทางธุรกิจ Asia/Bangkok
          </p>
        </div>
      </header>
      <p class="report-warning" role="note">
        <strong>รายงานการสั่งซื้อ ไม่ใช่รายรับ</strong>
        ตัวเลขด้านล่างคือมูลค่าออเดอร์ที่บันทึกในระบบเท่านั้น
        ยังไม่มีข้อมูลการรับเงิน การชำระเงินผ่าน PromptPay หรือยอดสุทธิ
      </p>
      @if (error()) {
        <div class="report-error" role="alert">
          {{ error() }}
          @if (store()) {
            <button type="button" (click)="refresh()" [disabled]="loading()">
              ลองใหม่
            </button>
          }
        </div>
      }
      @if (!store() && !error()) {
        <p class="report-empty" role="status">
          กำลังตรวจสอบบัญชีและสิทธิ์เจ้าของร้าน...
        </p>
      }
      @if (store()) {
        <div class="report-controls">
          <label for="report-day">เลือกวันที่ (ประเทศไทย)</label>
          <input
            id="report-day"
            type="date"
            min="2020-01-01"
            [max]="maxDay"
            [value]="day()"
            (change)="changeDay($event)"
          />
          <button type="button" [disabled]="loading()" (click)="refresh()">
            {{ loading() ? "กำลังโหลด..." : "แสดงรายงาน" }}
          </button>
          @if (report()) {
            <a class="report-export" [href]="exportUrl()" download
              >ส่งออก CSV</a
            >
          }
        </div>

        @if (report(); as data) {
          <div
            class="report-kpis"
            aria-label="จำนวนออเดอร์และมูลค่าที่ยังไม่ชำระ"
          >
            <article>
              <span>จำนวนออเดอร์</span>
              <strong>{{ data.orderCount }}</strong>
              <small>รวมทั้งที่ยกเลิก</small>
            </article>
            <article>
              <span>มูลค่าออเดอร์ทั้งหมด</span>
              <strong>{{ money(data.orderedAmountSatang) }} ฿</strong>
              <small>ยอดสั่ง ไม่ใช่เงินรับแล้ว</small>
            </article>
            <article>
              <span>มูลค่าออเดอร์ที่ไม่ยกเลิก</span>
              <strong>{{ money(data.activeOrderedAmountSatang) }} ฿</strong>
              <small>ยังไม่มีการยืนยันชำระเงิน</small>
            </article>
            <article>
              <span>มูลค่าออเดอร์ที่ยกเลิก</span>
              <strong>{{ money(data.cancelledOrderedAmountSatang) }} ฿</strong>
              <small>การยกเลิกไม่ใช่การคืนเงิน</small>
            </article>
          </div>

          <div class="report-sections">
            <section class="report-card" aria-labelledby="statuses-title">
              <h2 id="statuses-title">สถานะคำสั่งซื้อ</h2>
              <dl class="report-stat-list">
                @for (entry of statuses; track entry) {
                  <div>
                    <dt>{{ statusLabel[entry] }}</dt>
                    <dd>{{ data.statusCounts[entry] }}</dd>
                  </div>
                }
              </dl>
            </section>
            <section class="report-card" aria-labelledby="performance-title">
              <h2 id="performance-title">ระยะเวลาการให้บริการ</h2>
              <dl class="report-stat-list">
                <div>
                  <dt>เวลาเฉลี่ยจนร้านรับออเดอร์</dt>
                  <dd>{{ seconds(data.avgSecondsToAccept) }}</dd>
                </div>
                <div>
                  <dt>เวลาเฉลี่ยจนเสิร์ฟ</dt>
                  <dd>{{ seconds(data.avgSecondsToServe) }}</dd>
                </div>
              </dl>
              <p class="report-hint">
                คำนวณจากเวลาเริ่มออเดอร์ถึงเหตุการณ์ที่บันทึกใน Audit Log
                เฉพาะออเดอร์ที่มีเหตุการณ์นั้น
              </p>
            </section>
          </div>

          <section class="report-card" aria-labelledby="popular-title">
            <h2 id="popular-title">
              สินค้าที่ถูกสั่งมากที่สุด (ไม่รวมออเดอร์ยกเลิก)
            </h2>
            @if (data.topProducts.length === 0) {
              <p class="report-empty">ยังไม่มีข้อมูลการสั่งซื้อในวันที่เลือก</p>
            } @else {
              <div class="report-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">สินค้า</th>
                      <th scope="col">จำนวนที่สั่ง</th>
                      <th scope="col">มูลค่าที่สั่ง (ยังไม่รับเงิน)</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (
                      product of data.topProducts;
                      track product.productId + product.productName
                    ) {
                      <tr>
                        <th scope="row">{{ product.productName }}</th>
                        <td>{{ product.unitsOrdered }}</td>
                        <td>{{ money(product.orderedAmountSatang) }} ฿</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
          <p class="report-hint">
            วัน {{ data.day }} · โซนเวลา {{ data.timezone }} · ประเภทข้อมูล
            {{ data.snapshotType }} · ไม่ใช่รายงาน Payment
          </p>
        } @else if (loading()) {
          <p class="report-empty" role="status">
            กำลังดึงรายงานจากฐานข้อมูล...
          </p>
        }
      }
    </section>
  `,
})
export class OperationalReportsPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(OperationalReportsApi);
  private readonly merchant = inject(MerchantOrderApi);
  private tenantId = "";
  private storeId = "";
  readonly day = signal(todayBangkok());
  readonly maxDay = todayBangkok(new Date(Date.now() + 86_400_000));
  readonly report = signal<OperationalDailyReport | null>(null);
  readonly store = signal<MerchantStore | null>(null);
  readonly loading = signal(true);
  readonly error = signal("");
  readonly statuses = [
    "submitted",
    "accepted",
    "preparing",
    "served",
    "cancelled",
  ] as const;
  readonly statusLabel = STATUS_LABEL;
  readonly money = formatReportSatang;
  readonly seconds = formatReportSeconds;

  ngOnInit(): void {
    this.tenantId = this.route.snapshot.paramMap.get("tenantId") ?? "";
    this.storeId = this.route.snapshot.paramMap.get("storeId") ?? "";
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const list = await this.merchant.stores();
      const store = list.stores.find(
        (x) =>
          x.tenantId === this.tenantId &&
          x.storeId === this.storeId &&
          (x.role === "owner" || x.role === "manager"),
      );
      if (!store) {
        this.error.set(
          "ไม่มีสิทธิ์ดูรายงานร้านนี้ (เฉพาะเจ้าของร้าน/ผู้จัดการ)",
        );
        return;
      }
      this.store.set(store);
      await this.refresh();
    } catch (error) {
      this.error.set(this.errorText(error));
    } finally {
      this.loading.set(false);
    }
  }

  changeDay(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.day.set(event.target.value);
      this.report.set(null);
    }
  }
  exportUrl(): string {
    return this.api.csvUrl(this.tenantId, this.storeId, this.day());
  }

  async refresh(): Promise<void> {
    if (this.loading() && this.report()) return;
    this.loading.set(true);
    this.error.set("");
    try {
      const report = await this.api.daily(
        this.tenantId,
        this.storeId,
        this.day(),
      );
      // Never render a server response as cash/revenue or verified payment.
      if (
        report.snapshotType !== "ordered_not_paid" ||
        report.paymentStatus !== "not_implemented"
      ) {
        throw new Error("ข้อมูลรายงานไม่อยู่ในประเภทออเดอร์ที่รองรับ");
      }
      this.report.set(report);
    } catch (error) {
      this.report.set(null);
      this.error.set(this.errorText(error));
    } finally {
      this.loading.set(false);
    }
  }

  private errorText(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
      if (error.status === 403 || error.status === 404)
        return "ไม่มีสิทธิ์ดูรายงานร้านนี้";
      if (error.status === 400) return "วันที่รายงานไม่ถูกต้อง";
      if (error.status === 0) return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ โปรดลองใหม่";
    }
    return error instanceof Error ? error.message : "โหลดรายงานไม่สำเร็จ";
  }
}
