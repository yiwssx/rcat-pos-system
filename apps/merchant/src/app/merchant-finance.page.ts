import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmLabel } from "@spartan-ng/helm/label";
import {
  FinanceException,
  FinanceRefund,
  FinanceReport,
  MerchantFinanceApi,
} from "./merchant-finance.api";
import { MerchantOrderApi } from "./merchant-order.api";
import { formatOrderNumber, formatSatang } from "./order-board.domain";
import { formatReportSatang } from "./operational-report.domain";

const EXCEPTION_NAMES = [
  ["underpayment", "ยอดโอนขาด"],
  ["overpayment", "ยอดโอนเกิน"],
  ["duplicate_transfer", "โอนเงินซ้ำ"],
  ["late_transfer", "โอนเงินล่าช้า"],
  ["cancelled_after_transfer", "ยกเลิกหลังโอน"],
  ["unmatched_transfer", "ยอดโอนไม่พบออเดอร์"],
  ["other", "รายการผิดปกติอื่น"],
] as const;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function satang(text: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const value =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(value) && value >= 1 && value <= 100_000_000
    ? value
    : null;
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HlmButton, HlmInput, HlmLabel],
  template: `
    <main
      class="finance-shell mx-auto grid w-full min-w-0 max-w-6xl gap-4 p-4 sm:p-6"
    >
      <a
        hlmBtn
        variant="link"
        class="w-fit px-0"
        [routerLink]="['/orders', tenantId, storeId]"
        >← กลับกระดานออเดอร์</a
      >
      <span
        class="finance-kicker text-xs font-semibold tracking-wide text-foreground"
        >รายงานการชำระเงิน</span
      >
      <h1 class="m-0 text-2xl font-semibold leading-tight sm:text-3xl">
        กระทบยอดและคืนเงิน
      </h1>
      <p
        class="finance-warning rounded-xl border border-preparing-line bg-preparing p-4 text-preparing-foreground"
      >
        ยอดรับเงินและคืนเงินในหน้านี้เป็นรายการที่พนักงานบันทึกหลังตรวจธนาคาร
        การบันทึกคืนเงินไม่ได้โอนเงินให้อัตโนมัติ
      </p>
      <div class="finance-top flex flex-wrap items-center gap-3">
        <label hlmLabel for="finance-days">ช่วงรายงาน</label>
        <select
          class="min-h-11 max-w-full rounded-xl border border-input bg-card px-3 py-2 text-foreground"
          id="finance-days"
          [value]="days()"
          (change)="setDays($event)"
        >
          <option value="7">7 วัน</option>
          <option value="30">30 วัน</option>
          <option value="90">90 วัน</option>
        </select>
        <button hlmBtn type="button" (click)="load()" [disabled]="loading()">
          {{ loading() ? "กำลังโหลด..." : "รีเฟรชรายงาน" }}
        </button>
      </div>
      @if (error()) {
        <p
          class="finance-error rounded-xl border border-destructive bg-danger-soft p-3 text-foreground"
          role="alert"
        >
          {{ error() }}
        </p>
      }
      @if (notice()) {
        <p
          role="status"
          class="finance-notice rounded-xl border border-served-line bg-served p-3 text-served-foreground"
        >
          {{ notice() }}
        </p>
      }
      @if (report(); as data) {
        <div
          class="finance-stats grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <article
            class="grid min-w-0 gap-2 rounded-xl border border-border bg-card p-4"
          >
            <small class="text-sm text-muted-foreground"
              >ยอดออเดอร์ในช่วง (ไม่ใช่เงินรับ)</small
            >
            <strong>{{ summaryMoney(data.summary.orderTotalSatang) }} ฿</strong>
            <small class="text-sm text-muted-foreground"
              >{{ data.summary.orderCount }} ออเดอร์</small
            >
          </article>
          <article
            class="grid min-w-0 gap-2 rounded-xl border border-border bg-card p-4"
          >
            <small class="text-sm text-muted-foreground"
              >ยังไม่มีการยืนยันรับเงิน</small
            >
            <strong
              >{{ summaryMoney(data.summary.outstandingSatang) }} ฿</strong
            >
            <small
              >{{
                data.summary.outstandingOrderCount
              }}
              ออเดอร์ไม่ถูกยกเลิก</small
            >
          </article>
          <article
            class="grid min-w-0 gap-2 rounded-xl border border-border bg-card p-4"
          >
            <small class="text-sm text-muted-foreground"
              >ยอดรับที่ร้านยืนยันในช่วง</small
            >
            <strong
              >{{ summaryMoney(data.summary.manualReceiptSatang) }} ฿</strong
            >
            <small class="text-sm text-muted-foreground"
              >พนักงานตรวจสอบและบันทึก</small
            >
          </article>
          <article
            class="grid min-w-0 gap-2 rounded-xl border border-border bg-card p-4"
          >
            <small class="text-sm text-muted-foreground"
              >คืนเงินที่ร้านบันทึกในช่วง</small
            >
            <strong
              >{{
                summaryMoney(data.summary.manualRefundRecordedSatang)
              }}
              ฿</strong
            >
            <small class="text-sm text-muted-foreground"
              >สุทธิจากรายการที่พนักงานบันทึก {{ manualNet() }} ฿</small
            >
          </article>
        </div>
        <p class="finance-subtle text-sm leading-relaxed text-muted-foreground">
          สลิปรอตรวจ {{ data.summary.submittedSlipCount }} รายการ ·
          คำขอคืนเงินค้าง
          {{ summaryMoney(data.summary.manualRefundPendingSatang) }} ฿ ·
          รายการผิดปกติเปิดอยู่ {{ data.summary.openExceptionCount }} รายการ ·
          ออเดอร์ยกเลิกหลังยืนยันเงิน
          {{ data.summary.cancelledConfirmedCount }} รายการ
        </p>
        <p class="finance-subtle text-sm leading-relaxed text-muted-foreground">
          ยอดออเดอร์นับตามวันที่สั่ง
          ส่วนยอดรับและคืนเงินนับตามวันที่พนักงานตรวจบันทึก
          จึงไม่ควรนำสองคอลัมน์มาหักลบกันแทนการตรวจรายการธนาคาร
        </p>

        <details
          class="min-w-0 rounded-xl border border-border bg-card p-4"
          open
        >
          <summary class="min-h-11 cursor-pointer py-2 font-semibold">
            ออเดอร์ยังไม่ยืนยันรับเงิน ({{
              data.summary.outstandingOrderCount
            }})
          </summary>
          <div class="finance-list grid gap-3 py-3">
            @for (order of data.outstandingOrders; track order.orderId) {
              <div
                class="finance-item grid min-w-0 gap-2 rounded-xl border border-border bg-muted p-3"
              >
                <strong>Order {{ number(order.displayNumber) }}</strong>
                <span>{{ money(order.amountSatang) }} ฿</span>
                <small
                  >{{ paymentLabel(order.paymentState) }} ·
                  {{ when(order.createdAt) }}</small
                >
              </div>
            } @empty {
              <p>ไม่มีออเดอร์ค้างรับในช่วงรายงาน</p>
            }
          </div>
          <small
            >แสดงสูงสุด 50 รายการล่าสุด ยอดรวมอ้างอิงฐานข้อมูลเต็มช่วง</small
          >
        </details>

        <details class="min-w-0 rounded-xl border border-border bg-card p-4">
          <summary class="min-h-11 cursor-pointer py-2 font-semibold">
            คำขอคืนเงินและบันทึกการโอนคืน ({{ data.refunds.length }})
          </summary>
          <p>
            คืนเงินจริงผ่านแอปธนาคารของร้านแยกต่างหาก
            ระบบนี้บันทึกหลักฐานการตรวจเท่านั้น
          </p>
          <div class="finance-list grid gap-3 py-3">
            @for (refund of data.refunds; track refund.refundId) {
              <div
                class="finance-item grid min-w-0 gap-2 rounded-xl border border-border bg-muted p-3"
              >
                <strong>Order {{ number(refund.displayNumber) }}</strong>
                <span
                  >{{ money(refund.amountSatang) }} ฿ ·
                  {{ refundState(refund.state) }}</span
                >
                <small
                  >{{ refund.reason }} · {{ when(refund.requestedAt) }}</small
                >
                @if (refund.state === "pending") {
                  <div class="finance-actions flex flex-wrap gap-2">
                    <button hlmBtn type="button" (click)="selectRefund(refund)">
                      บันทึกผลโอนคืน
                    </button>
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      class="finance-quiet"
                      [disabled]="busy()"
                      (click)="voidRefund(refund)"
                    >
                      ยกเลิกคำขอคืน
                    </button>
                  </div>
                }
              </div>
            } @empty {
              <p>ยังไม่มีคำขอคืนเงิน</p>
            }
          </div>
          @if (selectedRefund(); as refund) {
            <section
              class="finance-action-form grid max-w-2xl gap-3 border-t border-border py-4"
            >
              <h3 class="text-base font-semibold">
                บันทึกการโอนคืน Order {{ number(refund.displayNumber) }}
              </h3>
              <p>
                ตรวจในบัญชีธนาคารก่อนทำเครื่องหมาย · ยอดคืน
                {{ money(refund.amountSatang) }} ฿
              </p>
              <label hlmLabel for="refund-bank-ref"
                >รหัสธุรกรรมเงินออกจากธนาคาร</label
              >
              <input
                hlmInput
                id="refund-bank-ref"
                [value]="bankRef()"
                autocomplete="off"
                maxlength="64"
                (input)="bankRef.set($any($event.target).value)"
              />
              <label hlmLabel for="refund-actual"
                >จำนวนเงินโอนคืนจริง (บาท)</label
              >
              <input
                hlmInput
                id="refund-actual"
                inputmode="decimal"
                [value]="actualRefund()"
                (input)="actualRefund.set($any($event.target).value)"
              />
              <label class="finance-check flex items-start gap-3">
                <input
                  class="size-5 shrink-0 accent-action"
                  type="checkbox"
                  [checked]="bankChecked()"
                  (change)="bankChecked.set($any($event.target).checked)"
                />
                ฉันตรวจสอบรายการเงินออกจากบัญชีร้านด้วยตัวเองแล้ว
              </label>
              <button
                hlmBtn
                type="button"
                [disabled]="!canRecordRefund() || busy()"
                (click)="recordRefund()"
              >
                บันทึกว่าร้านโอนคืนแล้ว
              </button>
            </section>
          }
          <section
            class="finance-action-form grid max-w-2xl gap-3 border-t border-border py-4"
          >
            <h3 class="text-base font-semibold">สร้างคำขอคืนเงิน</h3>
            <label hlmLabel for="refund-order"
              >เลือก Order ที่ร้านเคยยืนยันรับเงิน</label
            >
            <select
              class="min-h-11 max-w-full rounded-xl border border-input bg-card px-3 py-2 text-foreground"
              id="refund-order"
              [value]="refundOrderId()"
              (change)="selectConfirmed($event)"
            >
              <option value="">เลือกออเดอร์</option>
              @for (order of data.confirmedOrders; track order.orderId) {
                <option [value]="order.orderId">
                  #{{ order.displayNumber.padStart(3, "0") }} ·
                  {{ money(order.amountSatang) }} ฿
                </option>
              }
            </select>
            <label hlmLabel for="refund-order-manual">
              หรือระบุรหัสออเดอร์จากระบบ (กรณีไม่อยู่ในรายการ)
            </label>
            <input
              hlmInput
              id="refund-order-manual"
              [value]="refundOrderId()"
              (input)="refundOrderId.set($any($event.target).value)"
              placeholder="รหัสออเดอร์จากระบบ"
            />
            <label hlmLabel for="refund-amount">ยอดขอคืน (บาท)</label>
            <input
              hlmInput
              id="refund-amount"
              inputmode="decimal"
              [value]="refundAmount()"
              (input)="refundAmount.set($any($event.target).value)"
            />
            <label hlmLabel for="refund-reason">เหตุผลการคืนเงิน</label>
            <input
              hlmInput
              id="refund-reason"
              maxlength="240"
              [value]="refundReason()"
              (input)="refundReason.set($any($event.target).value)"
            />
            <button
              hlmBtn
              type="button"
              [disabled]="!canRequestRefund() || busy()"
              (click)="requestRefund()"
            >
              บันทึกคำขอคืนเงิน (ยังไม่โอนเงินจริง)
            </button>
          </section>
        </details>

        <details class="min-w-0 rounded-xl border border-border bg-card p-4">
          <summary class="min-h-11 cursor-pointer py-2 font-semibold">
            รายการผิดปกติและกระทบยอด ({{ data.summary.openExceptionCount }}
            เปิดอยู่)
          </summary>
          <p>
            ใช้สำหรับเงินโอนขาด/เกิน ซ้ำ โอนล่าช้า และยอดไม่พบ Order
            รายการนี้ไม่เปลี่ยนสถานะชำระหรือคืนเงินของ Order
          </p>
          <div class="finance-list grid gap-3 py-3">
            @for (item of data.exceptions; track item.exceptionId) {
              <div
                class="finance-item grid min-w-0 gap-2 rounded-xl border border-border bg-muted p-3"
              >
                <strong>{{ exceptionName(item.kind) }}</strong>
                <span
                  >{{ item.state === "open" ? "รอดำเนินการ" : "แก้ไขแล้ว" }}
                  @if (item.amountSatang !== null) {
                    · {{ money(item.amountSatang) }} ฿
                  }
                </span>
                <small class="text-sm text-muted-foreground">{{
                  item.note
                }}</small>
                @if (item.state === "open") {
                  <button
                    hlmBtn
                    type="button"
                    [disabled]="busy()"
                    (click)="selectedException.set(item); resolution.set('')"
                  >
                    บันทึกการแก้ไข
                  </button>
                }
              </div>
            } @empty {
              <p>ยังไม่มีรายการผิดปกติ</p>
            }
          </div>
          @if (selectedException(); as item) {
            <section
              class="finance-action-form grid max-w-2xl gap-3 border-t border-border py-4"
            >
              <h3 class="text-base font-semibold">
                ปิดรายการผิดปกติ: {{ exceptionName(item.kind) }}
              </h3>
              <label hlmLabel for="exception-resolution">วิธีจัดการจริง</label>
              <input
                hlmInput
                id="exception-resolution"
                maxlength="240"
                [value]="resolution()"
                (input)="resolution.set($any($event.target).value)"
              />
              <button
                hlmBtn
                type="button"
                [disabled]="busy() || resolution().trim().length < 4"
                (click)="resolveException()"
              >
                บันทึกปิดรายการ
              </button>
            </section>
          }
          <section
            class="finance-action-form grid max-w-2xl gap-3 border-t border-border py-4"
          >
            <h3 class="text-base font-semibold">เพิ่มรายการผิดปกติ</h3>
            <label hlmLabel for="exception-kind">ประเภท</label>
            <select
              class="min-h-11 max-w-full rounded-xl border border-input bg-card px-3 py-2 text-foreground"
              id="exception-kind"
              [value]="exceptionKind()"
              (change)="exceptionKind.set($any($event.target).value)"
            >
              @for (entry of exceptionNames; track entry[0]) {
                <option [value]="entry[0]">{{ entry[1] }}</option>
              }
            </select>
            <label hlmLabel for="exception-order"
              >รหัสออเดอร์จากระบบ (ไม่บังคับ)</label
            >
            <input
              hlmInput
              id="exception-order"
              [value]="exceptionOrder()"
              (input)="exceptionOrder.set($any($event.target).value)"
              placeholder="ไม่ระบุหากเป็นยอดโอนที่ไม่พบออเดอร์"
            />
            <label hlmLabel for="exception-amount"
              >จำนวนเงินที่เกี่ยวข้อง (บาท ไม่บังคับ)</label
            >
            <input
              hlmInput
              id="exception-amount"
              inputmode="decimal"
              [value]="exceptionAmount()"
              (input)="exceptionAmount.set($any($event.target).value)"
            />
            <label hlmLabel for="exception-note"
              >รายละเอียด (ไม่ใส่เลขบัญชีหรือข้อมูลอ่อนไหว)</label
            >
            <input
              hlmInput
              id="exception-note"
              maxlength="240"
              [value]="exceptionNote()"
              (input)="exceptionNote.set($any($event.target).value)"
            />
            <button
              hlmBtn
              type="button"
              [disabled]="busy() || !canOpenException()"
              (click)="openException()"
            >
              บันทึกรายการผิดปกติ
            </button>
          </section>
        </details>
        <p class="finance-footer text-sm leading-relaxed text-muted-foreground">
          รวบรวมเฉพาะ 50 รายการต่อหมวดในหน้าจอ;
          ยอดรวมรายงานคำนวณจากทั้งฐานข้อมูล ห้ามใช้การสรุปนี้แทน Bank Statement
          หรือออกหลักฐานการชำระเงินอัตโนมัติ
        </p>
      }
    </main>
  `,
})
export class MerchantFinancePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(MerchantFinanceApi);
  private readonly merchant = inject(MerchantOrderApi);
  readonly tenantId = this.route.snapshot.paramMap.get("tenantId") ?? "";
  readonly storeId = this.route.snapshot.paramMap.get("storeId") ?? "";
  readonly days = signal(30);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly report = signal<FinanceReport | null>(null);
  readonly money = formatSatang;
  readonly number = formatOrderNumber;
  readonly summaryMoney = formatReportSatang;
  readonly exceptionNames = EXCEPTION_NAMES;
  readonly refundOrderId = signal("");
  readonly refundAmount = signal("");
  readonly refundReason = signal("");
  readonly selectedRefund = signal<FinanceRefund | null>(null);
  readonly bankRef = signal("");
  readonly actualRefund = signal("");
  readonly bankChecked = signal(false);
  readonly exceptionKind = signal<string>("underpayment");
  readonly exceptionOrder = signal("");
  readonly exceptionAmount = signal("");
  readonly exceptionNote = signal("");
  readonly selectedException = signal<FinanceException | null>(null);
  readonly resolution = signal("");
  readonly manualNet = computed(() => {
    const s = this.report()?.summary;
    if (!s) return "—";
    try {
      const difference =
        BigInt(s.manualReceiptSatang) - BigInt(s.manualRefundRecordedSatang);
      const absolute = difference < 0n ? -difference : difference;
      const formatted = formatReportSatang(String(absolute));
      return difference < 0n ? "-" + formatted : formatted;
    } catch {
      return "—";
    }
  });
  readonly canRecordRefund = computed(
    () =>
      !!this.selectedRefund() &&
      this.bankChecked() &&
      /^[A-Za-z0-9._-]{6,64}$/.test(this.bankRef()) &&
      satang(this.actualRefund()) === this.selectedRefund()?.amountSatang,
  );
  readonly canRequestRefund = computed(
    () =>
      ID.test(this.refundOrderId()) &&
      satang(this.refundAmount()) !== null &&
      this.refundReason().trim().length >= 4,
  );
  readonly canOpenException = computed(
    () =>
      this.exceptionNote().trim().length >= 4 &&
      (!this.exceptionOrder().trim() ||
        ID.test(this.exceptionOrder().trim())) &&
      (!this.exceptionAmount().trim() ||
        satang(this.exceptionAmount()) !== null),
  );

  ngOnInit(): void {
    void this.load();
  }
  setDays(event: Event): void {
    this.days.set(Number((event.target as HTMLSelectElement).value));
    void this.load();
  }
  when(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("th-TH");
  }
  paymentLabel(value: string): string {
    return (
      (
        {
          not_requested: "ยังไม่ได้เปิดคำขอชำระ",
          awaiting_payment: "รอชำระ",
          slip_submitted: "ส่งสลิปรอตรวจ",
          manual_confirmed: "ร้านยืนยันรับเงินจริง",
        } as Record<string, string>
      )[value] ?? "รอตรวจสอบ"
    );
  }
  refundState(value: string): string {
    return (
      (
        {
          pending: "ยังไม่มีหลักฐานการคืนเงินจริง",
          manually_recorded: "ร้านบันทึกว่าโอนคืนแล้ว",
          voided: "ยกเลิกคำขอ",
        } as Record<string, string>
      )[value] ?? "ไม่ทราบสถานะ"
    );
  }
  exceptionName(kind: string): string {
    return EXCEPTION_NAMES.find((entry) => entry[0] === kind)?.[1] ?? kind;
  }
  selectConfirmed(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.refundOrderId.set(id);
    const order = this.report()?.confirmedOrders.find((o) => o.orderId === id);
    this.refundAmount.set(order ? (order.amountSatang / 100).toFixed(2) : "");
  }
  selectRefund(refund: FinanceRefund): void {
    this.selectedRefund.set(refund);
    this.actualRefund.set((refund.amountSatang / 100).toFixed(2));
    this.bankRef.set("");
    this.bankChecked.set(false);
  }
  async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set("");
    try {
      const stores = await this.merchant.stores();
      const current = stores.stores.find(
        (s) => s.tenantId === this.tenantId && s.storeId === this.storeId,
      );
      if (
        !current ||
        (current.role !== "owner" && current.role !== "manager")
      ) {
        throw new Error("บัญชีนี้ไม่มีสิทธิ์เข้าถึงบัญชีการเงินร้าน");
      }
      const data = await this.api.report(
        this.tenantId,
        this.storeId,
        this.days(),
      );
      this.report.set(data);
      if (
        this.selectedRefund() &&
        !data.refunds.some(
          (r) =>
            r.refundId === this.selectedRefund()?.refundId &&
            r.state === "pending",
        )
      ) {
        this.selectedRefund.set(null);
      }
    } catch {
      this.error.set(
        "โหลดบัญชีการเงินไม่ได้ กรุณาตรวจสอบสิทธิ์หรือระบบฐานข้อมูล",
      );
    } finally {
      this.loading.set(false);
    }
  }
  private async mutate(
    action: () => Promise<unknown>,
    success: string,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await action();
      this.notice.set(success);
      await this.load();
    } catch {
      this.error.set(
        "บันทึกไม่สำเร็จ ระบบอาจยังไม่เปิด หรือมีผู้แก้ไขรายการก่อนแล้ว กรุณารีเฟรช",
      );
    } finally {
      this.busy.set(false);
    }
  }
  async requestRefund(): Promise<void> {
    if (!this.canRequestRefund()) return;
    await this.mutate(
      () =>
        this.api.requestRefund(
          this.tenantId,
          this.storeId,
          this.refundOrderId(),
          satang(this.refundAmount())!,
          this.refundReason().trim(),
        ),
      "บันทึกคำขอคืนเงินแล้ว ยังไม่มีการโอนเงินจริงจากระบบนี้",
    );
  }
  async recordRefund(): Promise<void> {
    const refund = this.selectedRefund();
    if (!refund || !this.canRecordRefund()) return;
    await this.mutate(
      () =>
        this.api.refundDecision(this.tenantId, this.storeId, refund.refundId, {
          action: "record",
          expectedRevision: refund.revision,
          bankReference: this.bankRef(),
          actualAmountSatang: satang(this.actualRefund())!,
          bankChecked: true,
        }),
      "บันทึกผลตรวจการโอนคืนด้วยพนักงาน (ไม่ได้รับการยืนยันจากธนาคารอัตโนมัติ)",
    );
  }
  async voidRefund(refund: FinanceRefund): Promise<void> {
    await this.mutate(
      () =>
        this.api.refundDecision(this.tenantId, this.storeId, refund.refundId, {
          action: "void",
          expectedRevision: refund.revision,
        }),
      "ยกเลิกคำขอคืนเงินแล้ว ไม่ใช่รายการธนาคาร",
    );
  }
  async openException(): Promise<void> {
    if (!this.canOpenException()) return;
    await this.mutate(
      () =>
        this.api.openException(this.tenantId, this.storeId, {
          orderId: this.exceptionOrder().trim() || null,
          kind: this.exceptionKind(),
          amountSatang: this.exceptionAmount().trim()
            ? satang(this.exceptionAmount())
            : null,
          note: this.exceptionNote().trim(),
        }),
      "เปิดรายการผิดปกติแล้ว ยังไม่ได้เปลี่ยนสถานะการรับเงิน",
    );
  }
  async resolveException(): Promise<void> {
    const selected = this.selectedException();
    if (!selected || this.resolution().trim().length < 4) return;
    await this.mutate(
      () =>
        this.api.resolveException(
          this.tenantId,
          this.storeId,
          selected.exceptionId,
          selected.revision,
          this.resolution().trim(),
        ),
      "บันทึกการปิดรายการผิดปกติแล้ว",
    );
  }
}
