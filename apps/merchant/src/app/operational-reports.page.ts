import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmCard } from "@spartan-ng/helm/card";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmLabel } from "@spartan-ng/helm/label";
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
  imports: [RouterLink, HlmButton, HlmCard, HlmInput, HlmLabel],
  template: `
    <section class="mx-auto box-border w-full max-w-7xl space-y-5 px-4 pb-14 pt-6 sm:px-6 lg:px-8" aria-labelledby="report-title">
      <header class="space-y-3 border-b border-border pb-5">
        <div>
          <a hlmBtn variant="link" class="min-h-11 px-0" routerLink="/">← กลับไปหน้าร้านค้า</a>
          <span class="block text-xs font-semibold uppercase tracking-widest text-muted-foreground">OPERATIONS / NOT PAYMENTS</span>
          <h1 id="report-title" class="text-2xl font-semibold tracking-tight sm:text-3xl">รายงานออเดอร์ประจำวัน</h1>
          <p class="text-sm leading-relaxed text-muted-foreground">
            {{ store()?.storeName || "กำลังตรวจสอบสิทธิ์ร้าน" }}
            · วันทางธุรกิจ Asia/Bangkok
          </p>
        </div>
      </header>
      <p class="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed" role="note">
        <strong class="block font-semibold">รายงานการสั่งซื้อ ไม่ใช่รายรับ</strong>
        ตัวเลขด้านล่างคือมูลค่าออเดอร์ที่บันทึกในระบบเท่านั้น
        ยังไม่มีข้อมูลการรับเงิน การชำระเงินผ่าน PromptPay หรือยอดสุทธิ
      </p>
      @if (error()) {
        <div class="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-relaxed text-destructive" role="alert">
          <span class="min-w-0 flex-1">{{ error() }}</span>
          @if (store()) {
            <button hlmBtn variant="outline" class="min-h-11" type="button" (click)="refresh()" [disabled]="loading()">
              ลองใหม่
            </button>
          }
        </div>
      }
      @if (!store() && !error()) {
        <p class="rounded-xl border border-dashed border-border bg-card p-5 text-sm leading-relaxed text-muted-foreground" role="status">
          กำลังตรวจสอบบัญชีและสิทธิ์เจ้าของร้าน...
        </p>
      }
      @if (store()) {
        <div class="flex flex-wrap items-end gap-3">
          <label hlmLabel for="report-day">เลือกวันที่ (ประเทศไทย)</label>
          <input
            hlmInput
            id="report-day"
            class="min-h-11 w-full tabular-nums"
            type="date"
            min="2020-01-01"
            [max]="maxDay"
            [value]="day()"
            (change)="changeDay($event)"
          />
          <button hlmBtn class="min-h-11" type="button" [disabled]="loading()" (click)="refresh()">
            {{ loading() ? "กำลังโหลด..." : "แสดงรายงาน" }}
          </button>
          @if (report()) {
            <a hlmBtn variant="outline" class="min-h-11" [href]="exportUrl()" download
              >ส่งออก CSV</a
            >
          }
        </div>

        @if (report(); as data) {
          <div
            class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="จำนวนออเดอร์และมูลค่าที่ยังไม่ชำระ"
          >
            <article hlmCard size="sm" class="min-w-0 gap-2 p-4">
              <span>จำนวนออเดอร์</span>
              <strong class="break-words text-2xl font-semibold tabular-nums">{{ data.orderCount }}</strong>
              <small class="text-xs leading-relaxed text-muted-foreground">รวมทั้งที่ยกเลิก</small>
            </article>
            <article hlmCard size="sm" class="min-w-0 gap-2 p-4">
              <span>มูลค่าออเดอร์ทั้งหมด</span>
              <strong class="break-words text-2xl font-semibold tabular-nums">{{ money(data.orderedAmountSatang) }} ฿</strong>
              <small class="text-xs leading-relaxed text-muted-foreground">ยอดสั่ง ไม่ใช่เงินรับแล้ว</small>
            </article>
            <article hlmCard size="sm" class="min-w-0 gap-2 p-4">
              <span>มูลค่าออเดอร์ที่ไม่ยกเลิก</span>
              <strong class="break-words text-2xl font-semibold tabular-nums">{{ money(data.activeOrderedAmountSatang) }} ฿</strong>
              <small class="text-xs leading-relaxed text-muted-foreground">ยังไม่มีการยืนยันชำระเงิน</small>
            </article>
            <article hlmCard size="sm" class="min-w-0 gap-2 p-4">
              <span>มูลค่าออเดอร์ที่ยกเลิก</span>
              <strong class="break-words text-2xl font-semibold tabular-nums">{{ money(data.cancelledOrderedAmountSatang) }} ฿</strong>
              <small class="text-xs leading-relaxed text-muted-foreground">การยกเลิกไม่ใช่การคืนเงิน</small>
            </article>
          </div>

          <div class="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <section hlmCard size="sm" class="min-w-0 gap-4 p-4 sm:p-5" aria-labelledby="statuses-title">
              <h2 id="statuses-title" class="text-lg font-semibold">สถานะคำสั่งซื้อ</h2>
              <dl class="m-0 divide-y divide-border">
                @for (entry of statuses; track entry) {
                  <div>
                    <dt class="text-sm leading-relaxed text-muted-foreground">{{ statusLabel[entry] }}</dt>
                    <dd class="m-0 shrink-0 font-semibold tabular-nums">{{ data.statusCounts[entry] }}</dd>
                  </div>
                }
              </dl>
            </section>
            <section hlmCard size="sm" class="min-w-0 gap-4 p-4 sm:p-5" aria-labelledby="performance-title">
              <h2 id="performance-title" class="text-lg font-semibold">ระยะเวลาการให้บริการ</h2>
              <dl class="m-0 divide-y divide-border">
                <div>
                  <dt class="text-sm leading-relaxed text-muted-foreground">เวลาเฉลี่ยจนร้านรับออเดอร์</dt>
                  <dd class="m-0 shrink-0 font-semibold tabular-nums">{{ seconds(data.avgSecondsToAccept) }}</dd>
                </div>
                <div>
                  <dt class="text-sm leading-relaxed text-muted-foreground">เวลาเฉลี่ยจนเสิร์ฟ</dt>
                  <dd class="m-0 shrink-0 font-semibold tabular-nums">{{ seconds(data.avgSecondsToServe) }}</dd>
                </div>
              </dl>
              <p class="text-sm leading-relaxed text-muted-foreground">
                คำนวณจากเวลาเริ่มออเดอร์ถึงเหตุการณ์ที่บันทึกใน Audit Log
                เฉพาะออเดอร์ที่มีเหตุการณ์นั้น
              </p>
            </section>
          </div>

          <section hlmCard size="sm" class="min-w-0 gap-4 p-4 sm:p-5" aria-labelledby="popular-title">
            <h2 id="popular-title" class="text-lg font-semibold">
              สินค้าที่ถูกสั่งมากที่สุด (ไม่รวมออเดอร์ยกเลิก)
            </h2>
            @if (data.topProducts.length === 0) {
              <p class="rounded-xl border border-dashed border-border bg-card p-5 text-sm leading-relaxed text-muted-foreground">ยังไม่มีข้อมูลการสั่งซื้อในวันที่เลือก</p>
            } @else {
              <div class="max-w-full overflow-x-auto rounded-xl border border-border">
                <table class="w-full min-w-[32rem] border-collapse text-left text-sm">
                  <thead class="bg-muted/40">
                    <tr>
                      <th scope="col" class="border-b border-border p-3 font-semibold">สินค้า</th>
                      <th scope="col" class="border-b border-border p-3 font-semibold">จำนวนที่สั่ง</th>
                      <th scope="col" class="border-b border-border p-3 font-semibold">มูลค่าที่สั่ง (ยังไม่รับเงิน)</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (
                      product of data.topProducts;
                      track product.productId + product.productName
                    ) {
                      <tr>
                        <th scope="row" class="border-b border-border p-3 font-medium">{{ product.productName }}</th>
                        <td class="border-b border-border p-3 tabular-nums">{{ product.unitsOrdered }}</td>
                        <td class="border-b border-border p-3 tabular-nums">{{ money(product.orderedAmountSatang) }} ฿</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
          <p class="text-sm leading-relaxed text-muted-foreground">
            วัน {{ data.day }} · โซนเวลา {{ data.timezone }} · ประเภทข้อมูล
            {{ data.snapshotType }} · ไม่ใช่รายงาน Payment
          </p>
        } @else if (loading()) {
          <p class="rounded-xl border border-dashed border-border bg-card p-5 text-sm leading-relaxed text-muted-foreground" role="status">
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
