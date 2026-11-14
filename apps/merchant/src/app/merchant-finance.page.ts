import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import {
  FinanceException,
  FinanceRefund,
  FinanceReport,
  MerchantFinanceApi,
} from "./merchant-finance.api";
import { MerchantOrderApi } from "./merchant-order.api";
import { formatSatang } from "./order-board.domain";
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
  imports: [RouterLink],
  styleUrls: ["./payment-finance.css"],
  template: `
    <main class="finance-shell">
      <a [routerLink]="['/orders', tenantId, storeId]">← กลับกระดานออเดอร์</a>
      <span class="finance-kicker">MANUAL FINANCE</span>
      <h1>กระทบยอดและคืนเงิน</h1>
      <p class="finance-warning">
        ตัวเลขด้านล่างเป็นบันทึกที่พนักงานยืนยันเอง
        ไม่ใช่ธุรกรรมที่ธนาคารตรวจสอบผ่าน API
        การบันทึกคืนเงินไม่ได้สั่งโอนเงินออกจากบัญชี
      </p>
      <div class="finance-top">
        <label for="finance-days">ช่วงรายงาน</label>
        <select id="finance-days" [value]="days()" (change)="setDays($event)">
          <option value="7">7 วัน</option>
          <option value="30">30 วัน</option>
          <option value="90">90 วัน</option>
        </select>
        <button type="button" (click)="load()" [disabled]="loading()">
          {{ loading() ? "กำลังโหลด..." : "รีเฟรชรายงาน" }}
        </button>
      </div>
      @if (error()) {
        <p class="finance-error" role="alert">{{ error() }}</p>
      }
      @if (notice()) {
        <p role="status" class="finance-notice">{{ notice() }}</p>
      }
      @if (report(); as data) {
        <div class="finance-stats">
          <article>
            <small>ยอดออเดอร์ในช่วง (ไม่ใช่เงินรับ)</small>
            <strong>{{ summaryMoney(data.summary.orderTotalSatang) }} ฿</strong>
            <small>{{ data.summary.orderCount }} ออเดอร์</small>
          </article>
          <article>
            <small>ยังไม่มีการยืนยันรับเงิน</small>
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
          <article>
            <small>ยอดรับที่ร้านยืนยันในช่วง</small>
            <strong
              >{{ summaryMoney(data.summary.manualReceiptSatang) }} ฿</strong
            >
            <small>บันทึกโดยพนักงาน ไม่ใช่ bank-verified</small>
          </article>
          <article>
            <small>คืนเงินที่ร้านบันทึกในช่วง</small>
            <strong
              >{{
                summaryMoney(data.summary.manualRefundRecordedSatang)
              }}
              ฿</strong
            >
            <small>สุทธิจากบันทึก Manual {{ manualNet() }} ฿</small>
          </article>
        </div>
        <p class="finance-subtle">
          สลิปรอตรวจ {{ data.summary.submittedSlipCount }} รายการ ·
          คำขอคืนเงินค้าง
          {{ summaryMoney(data.summary.manualRefundPendingSatang) }} ฿ ·
          รายการผิดปกติเปิดอยู่ {{ data.summary.openExceptionCount }} รายการ ·
          ออเดอร์ยกเลิกหลังยืนยันเงิน
          {{ data.summary.cancelledConfirmedCount }} รายการ
        </p>
        <p class="finance-subtle">
          ยอดออเดอร์นับตามวันที่สั่ง
          ส่วนยอดรับและคืนเงินนับตามวันที่พนักงานตรวจบันทึก
          จึงไม่ควรนำสองคอลัมน์มาหักลบกันแทนการตรวจรายการธนาคาร
        </p>

        <details open>
          <summary>
            ออเดอร์ยังไม่ยืนยันรับเงิน ({{
              data.summary.outstandingOrderCount
            }})
          </summary>
          <div class="finance-list">
            @for (order of data.outstandingOrders; track order.orderId) {
              <div class="finance-item">
                <strong>Order #{{ order.orderId.slice(0, 8) }}</strong>
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

        <details>
          <summary>
            คำขอคืนเงินและบันทึกการโอนคืน ({{ data.refunds.length }})
          </summary>
          <p>
            คืนเงินจริงผ่านแอปธนาคารของร้านแยกต่างหาก
            ระบบนี้บันทึกหลักฐานการตรวจเท่านั้น
          </p>
          <div class="finance-list">
            @for (refund of data.refunds; track refund.refundId) {
              <div class="finance-item">
                <strong>Order #{{ refund.orderId.slice(0, 8) }}</strong>
                <span
                  >{{ money(refund.amountSatang) }} ฿ ·
                  {{ refundState(refund.state) }}</span
                >
                <small
                  >{{ refund.reason }} · {{ when(refund.requestedAt) }}</small
                >
                @if (refund.state === "pending") {
                  <div class="finance-actions">
                    <button type="button" (click)="selectRefund(refund)">
                      บันทึกผลโอนคืน
                    </button>
                    <button
                      type="button"
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
            <section class="finance-action-form">
              <h3>บันทึกการโอนคืน Order #{{ refund.orderId.slice(0, 8) }}</h3>
              <p>
                ตรวจในบัญชีธนาคารก่อนทำเครื่องหมาย · ยอดคืน
                {{ money(refund.amountSatang) }} ฿
              </p>
              <label for="refund-bank-ref">รหัสธุรกรรมเงินออกจากธนาคาร</label>
              <input
                id="refund-bank-ref"
                [value]="bankRef()"
                autocomplete="off"
                maxlength="64"
                (input)="bankRef.set($any($event.target).value)"
              />
              <label for="refund-actual">จำนวนเงินโอนคืนจริง (บาท)</label>
              <input
                id="refund-actual"
                inputmode="decimal"
                [value]="actualRefund()"
                (input)="actualRefund.set($any($event.target).value)"
              />
              <label class="finance-check">
                <input
                  type="checkbox"
                  [checked]="bankChecked()"
                  (change)="bankChecked.set($any($event.target).checked)"
                />
                ฉันตรวจสอบรายการเงินออกจากบัญชีร้านด้วยตัวเองแล้ว
              </label>
              <button
                type="button"
                [disabled]="!canRecordRefund() || busy()"
                (click)="recordRefund()"
              >
                บันทึกว่าร้านโอนคืนแล้ว
              </button>
            </section>
          }
          <section class="finance-action-form">
            <h3>สร้างคำขอคืนเงิน</h3>
            <label for="refund-order"
              >เลือก Order ที่ร้านเคยยืนยันรับเงิน</label
            >
            <select
              id="refund-order"
              [value]="refundOrderId()"
              (change)="selectConfirmed($event)"
            >
              <option value="">เลือกออเดอร์</option>
              @for (order of data.confirmedOrders; track order.orderId) {
                <option [value]="order.orderId">
                  #{{ order.orderId.slice(0, 8) }} ·
                  {{ money(order.amountSatang) }} ฿
                </option>
              }
            </select>
            <label for="refund-order-manual">
              หรือวาง Order UUID ที่เคยยืนยันรับเงินแล้ว (กรณีเกินช่วงรายงาน)
            </label>
            <input
              id="refund-order-manual"
              [value]="refundOrderId()"
              (input)="refundOrderId.set($any($event.target).value)"
              placeholder="Order UUID"
            />
            <label for="refund-amount">ยอดขอคืน (บาท)</label>
            <input
              id="refund-amount"
              inputmode="decimal"
              [value]="refundAmount()"
              (input)="refundAmount.set($any($event.target).value)"
            />
            <label for="refund-reason">เหตุผลการคืนเงิน</label>
            <input
              id="refund-reason"
              maxlength="240"
              [value]="refundReason()"
              (input)="refundReason.set($any($event.target).value)"
            />
            <button
              type="button"
              [disabled]="!canRequestRefund() || busy()"
              (click)="requestRefund()"
            >
              บันทึกคำขอคืนเงิน (ยังไม่โอนเงินจริง)
            </button>
          </section>
        </details>

        <details>
          <summary>
            รายการผิดปกติและกระทบยอด ({{ data.summary.openExceptionCount }}
            เปิดอยู่)
          </summary>
          <p>
            ใช้สำหรับเงินโอนขาด/เกิน ซ้ำ โอนล่าช้า และยอดไม่พบ Order
            รายการนี้ไม่เปลี่ยนสถานะชำระหรือคืนเงินของ Order
          </p>
          <div class="finance-list">
            @for (item of data.exceptions; track item.exceptionId) {
              <div class="finance-item">
                <strong>{{ exceptionName(item.kind) }}</strong>
                <span
                  >{{ item.state === "open" ? "รอดำเนินการ" : "แก้ไขแล้ว" }}
                  @if (item.amountSatang !== null) {
                    · {{ money(item.amountSatang) }} ฿
                  }
                </span>
                <small>{{ item.note }}</small>
                @if (item.state === "open") {
                  <button
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
            <section class="finance-action-form">
              <h3>ปิดรายการผิดปกติ: {{ exceptionName(item.kind) }}</h3>
              <label for="exception-resolution">วิธีจัดการจริง</label>
              <input
                id="exception-resolution"
                maxlength="240"
                [value]="resolution()"
                (input)="resolution.set($any($event.target).value)"
              />
              <button
                type="button"
                [disabled]="busy() || resolution().trim().length < 4"
                (click)="resolveException()"
              >
                บันทึกปิดรายการ
              </button>
            </section>
          }
          <section class="finance-action-form">
            <h3>เพิ่มรายการผิดปกติ</h3>
            <label for="exception-kind">ประเภท</label>
            <select
              id="exception-kind"
              [value]="exceptionKind()"
              (change)="exceptionKind.set($any($event.target).value)"
            >
              @for (entry of exceptionNames; track entry[0]) {
                <option [value]="entry[0]">{{ entry[1] }}</option>
              }
            </select>
            <label for="exception-order">Order UUID (ไม่บังคับ)</label>
            <input
              id="exception-order"
              [value]="exceptionOrder()"
              (input)="exceptionOrder.set($any($event.target).value)"
              placeholder="ไม่ระบุหากเป็นยอดโอนที่ไม่พบออเดอร์"
            />
            <label for="exception-amount"
              >จำนวนเงินที่เกี่ยวข้อง (บาท ไม่บังคับ)</label
            >
            <input
              id="exception-amount"
              inputmode="decimal"
              [value]="exceptionAmount()"
              (input)="exceptionAmount.set($any($event.target).value)"
            />
            <label for="exception-note"
              >รายละเอียด (ไม่ใส่เลขบัญชีหรือข้อมูลอ่อนไหว)</label
            >
            <input
              id="exception-note"
              maxlength="240"
              [value]="exceptionNote()"
              (input)="exceptionNote.set($any($event.target).value)"
            />
            <button
              type="button"
              [disabled]="busy() || !canOpenException()"
              (click)="openException()"
            >
              บันทึกรายการผิดปกติ
            </button>
          </section>
        </details>
        <p class="finance-footer">
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
