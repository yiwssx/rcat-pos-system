import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MerchantOrderApi, PaymentSlipReview } from "./merchant-order.api";
import { formatOrderNumber, formatSatang } from "./order-board.domain";

function satangFromInput(text: string): number | null {
  const match = /^([0-9]{1,7})(?:\.([0-9]{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const satang =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(satang) ? satang : null;
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="review-shell" aria-labelledby="review-title">
      <a [routerLink]="['/orders', tenantId, storeId]">← กลับกระดานออเดอร์</a>
      <span class="eyebrow">MANUAL PAYMENT REVIEW</span>
      <h1 id="review-title">ตรวจสลิป PromptPay</h1>
      <p class="review-warning">
        สลิปเป็นเพียงหลักฐานที่ลูกค้าส่ง ไม่ได้ยืนยันว่าเงินเข้าบัญชีแล้ว
        ตรวจรายการรับเงินจริงในแอปธนาคารของร้านก่อนกดยืนยันเสมอ
      </p>
      @if (error()) {
        <p class="review-error" role="alert">{{ error() }}</p>
      }
      @if (notice()) {
        <p role="status">{{ notice() }}</p>
      }
      <button type="button" (click)="refresh()" [disabled]="loading()">
        {{ loading() ? "กำลังโหลด..." : "รีเฟรชคิวตรวจสลิป" }}
      </button>
      @if (allowed()) {
        <p class="review-muted">สลิปรอตรวจ {{ items().length }} รายการล่าสุด</p>
        @if (!loading() && !items().length) {
          <p>ขณะนี้ไม่มีสลิปที่รอการตรวจสอบ</p>
        }
        <div class="review-layout">
          <div class="review-list">
            @for (item of items(); track item.slipId) {
              <button
                type="button"
                [class.is-selected]="selected()?.slipId === item.slipId"
                (click)="choose(item)"
              >
                <strong>Order {{ number(item.displayNumber) }}</strong>
                <span>{{ money(item.amountSatang) }} ฿</span>
                <small>ส่งเมื่อ {{ time(item.submittedAt) }}</small>
              </button>
            }
          </div>
          @if (selected(); as slip) {
            <section class="review-detail" aria-labelledby="slip-heading">
              <h2 id="slip-heading">
                ตรวจหลักฐานของ Order {{ number(slip.displayNumber) }}
              </h2>
              <p>
                <strong>ยอดที่ต้องรับ: {{ money(slip.amountSatang) }} ฿</strong>
              </p>
              <img
                [src]="imageUrl()"
                alt="สลิปที่ลูกค้าส่งเพื่อให้ร้านตรวจสอบยอดเงินจริง"
                width="340"
              />
              <p class="review-warning">
                เปรียบเทียบผู้รับเงิน จำนวนเงิน เวลา และรหัสธุรกรรม
                กับรายการเงินเข้าจริงในบัญชีร้าน ไม่ยืนยันจากรูปภาพอย่างเดียว
              </p>
              <label for="bank-ref">รหัสอ้างอิงธุรกรรมจากธนาคาร *</label>
              <input
                id="bank-ref"
                type="text"
                autocomplete="off"
                maxlength="64"
                [value]="bankReference()"
                (input)="bankReference.set($any($event.target).value)"
                placeholder="รหัสธุรกรรมจากรายการเงินเข้า"
              />
              <label for="actual-amount"
                >จำนวนเงินที่เข้าบัญชีจริง (บาท) *</label
              >
              <input
                id="actual-amount"
                inputmode="decimal"
                type="text"
                autocomplete="off"
                [value]="actualAmount()"
                (input)="actualAmount.set($any($event.target).value)"
                placeholder="เช่น 120.00"
              />
              <label class="review-check">
                <input
                  type="checkbox"
                  [checked]="bankChecked()"
                  (change)="bankChecked.set($any($event.target).checked)"
                />
                ฉันตรวจสอบยอดเงินเข้าจริงจากบัญชีธนาคารร้านแล้ว
              </label>
              <div class="review-actions">
                <button
                  type="button"
                  class="review-confirm"
                  [disabled]="!canConfirm() || busy()"
                  (click)="decide('confirm')"
                >
                  ยืนยันว่ารับเงินจริงแล้ว
                </button>
                <button
                  type="button"
                  class="review-reject"
                  [disabled]="busy()"
                  (click)="decide('reject')"
                >
                  ปฏิเสธสลิป
                </button>
              </div>
            </section>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .review-shell {
        max-width: 1050px;
        margin: auto;
        padding: 1.2rem;
      }
      .review-shell h1 {
        margin: 0.4rem 0 0.8rem;
      }
      .eyebrow {
        display: block;
        margin-top: 0.9rem;
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        color: #8a440d;
      }
      .review-warning {
        padding: 0.85rem;
        border-radius: 0.8rem;
        background: #fff4e4;
        color: #643c1b;
      }
      .review-error {
        color: #ae2727;
        font-weight: 650;
      }
      .review-muted {
        color: #5c6673;
        font-size: 0.9rem;
      }
      .review-layout {
        display: grid;
        grid-template-columns: minmax(190px, 300px) minmax(0, 1fr);
        gap: 1rem;
        margin-top: 1rem;
      }
      .review-list {
        display: grid;
        align-content: start;
        gap: 0.5rem;
      }
      .review-list button {
        text-align: left;
        border: 1px solid #e5d9ca;
        background: #fff;
        border-radius: 0.75rem;
        padding: 0.85rem;
        display: grid;
        gap: 0.3rem;
      }
      .review-list button.is-selected {
        border: 2px solid #c94e08;
      }
      .review-detail {
        min-width: 0;
        display: grid;
        gap: 0.55rem;
        background: white;
        border: 1px solid #e7dccf;
        border-radius: 1rem;
        padding: 1.1rem;
      }
      .review-detail h2 {
        font-size: 1.05rem;
        margin: 0;
      }
      .review-detail img {
        width: min(100%, 340px);
        max-height: 440px;
        object-fit: contain;
        background: #f5f5f5;
        border-radius: 0.5rem;
      }
      .review-detail input[type="text"] {
        width: 100%;
        min-height: 44px;
        padding: 0.65rem;
        border: 1px solid #bdbdbd;
        border-radius: 0.5rem;
      }
      .review-check {
        display: flex;
        align-items: start;
        gap: 0.5rem;
        padding: 0.6rem 0;
      }
      .review-check input {
        width: 20px;
        height: 20px;
      }
      .review-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
      }
      .review-actions button,
      .review-shell > button {
        min-height: 44px;
        padding: 0.6rem 0.9rem;
        border-radius: 0.6rem;
        cursor: pointer;
      }
      .review-confirm {
        background: #b9470e;
        color: #fff;
        border: none;
      }
      .review-reject {
        background: #fff;
        border: 1px solid #9d4b4b;
        color: #7a2020;
      }
      button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      @media (max-width: 680px) {
        .review-layout {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class PaymentReviewPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(MerchantOrderApi);
  readonly tenantId = this.route.snapshot.paramMap.get("tenantId") ?? "";
  readonly storeId = this.route.snapshot.paramMap.get("storeId") ?? "";
  readonly items = signal<PaymentSlipReview[]>([]);
  readonly selected = signal<PaymentSlipReview | null>(null);
  readonly error = signal("");
  readonly notice = signal("");
  readonly allowed = signal(false);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly bankChecked = signal(false);
  readonly bankReference = signal("");
  readonly actualAmount = signal("");
  readonly money = formatSatang;
  readonly number = formatOrderNumber;
  readonly imageUrl = computed(() => {
    const item = this.selected();
    return item
      ? this.api.paymentSlipImage(this.tenantId, this.storeId, item.slipId)
      : "";
  });
  readonly canConfirm = computed(() => {
    const item = this.selected();
    return (
      !!item &&
      this.bankChecked() &&
      /^[A-Za-z0-9._-]{6,64}$/.test(this.bankReference()) &&
      satangFromInput(this.actualAmount()) === item.amountSatang
    );
  });

  ngOnInit(): void {
    void this.refresh();
  }

  time(value: string): string {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString("th-TH");
  }

  async refresh(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set("");
    try {
      const stores = await this.api.stores();
      const store = stores.stores.find(
        (s) => s.tenantId === this.tenantId && s.storeId === this.storeId,
      );
      if (!store || (store.role !== "owner" && store.role !== "manager")) {
        this.allowed.set(false);
        this.items.set([]);
        throw new Error("บัญชีนี้ไม่มีสิทธิ์ตรวจสลิปของร้าน");
      }
      this.allowed.set(true);
      const queue = await this.api.paymentReviewQueue(
        this.tenantId,
        this.storeId,
      );
      this.items.set(queue.items);
      const picked = this.selected();
      this.selected.set(
        queue.items.find((s) => s.slipId === picked?.slipId) ?? null,
      );
    } catch {
      this.error.set(
        "ไม่สามารถเปิดคิวตรวจสลิปได้ กรุณาตรวจสอบสิทธิ์และลองใหม่",
      );
    } finally {
      this.loading.set(false);
    }
  }

  choose(item: PaymentSlipReview): void {
    this.selected.set(item);
    this.bankChecked.set(false);
    this.bankReference.set("");
    this.actualAmount.set("");
    this.notice.set("");
  }

  async decide(action: "confirm" | "reject"): Promise<void> {
    const item = this.selected();
    if (!item || this.busy() || (action === "confirm" && !this.canConfirm())) {
      return;
    }
    this.busy.set(true);
    this.error.set("");
    try {
      const payload =
        action === "confirm"
          ? {
              action,
              expectedRevision: item.revision,
              bankReference: this.bankReference(),
              actualAmountSatang: satangFromInput(this.actualAmount())!,
              bankChecked: true,
            }
          : { action, expectedRevision: item.revision };
      await this.api.paymentDecision(
        this.tenantId,
        this.storeId,
        item.slipId,
        payload,
      );
      this.notice.set(
        action === "confirm"
          ? "บันทึกการยืนยันรับเงินจริงโดยผู้ตรวจสอบแล้ว (ไม่ใช่ยืนยันจากธนาคารอัตโนมัติ)"
          : "ปฏิเสธสลิปแล้ว ลูกค้าสามารถส่งหลักฐานใหม่ได้",
      );
      this.selected.set(null);
      this.bankChecked.set(false);
      await this.refresh();
    } catch {
      this.error.set(
        "บันทึกผลตรวจไม่สำเร็จ อาจมีผู้ตรวจสอบก่อนแล้ว กรุณารีเฟรช",
      );
    } finally {
      this.busy.set(false);
    }
  }
}
