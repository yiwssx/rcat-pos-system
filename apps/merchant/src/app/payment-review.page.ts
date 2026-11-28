import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmLabel } from "@spartan-ng/helm/label";
import { MerchantOrderApi, PaymentSlipReview } from "./merchant-order.api";
import { formatOrderNumber, formatSatang } from "./order-board.domain";
import { decodeSlipReference } from "./slip-reference";

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
  imports: [RouterLink, HlmButton, HlmInput, HlmLabel],
  template: `
    <section
      class="review-shell mx-auto grid w-full min-w-0 max-w-5xl gap-4 p-4 sm:p-6"
      aria-labelledby="review-title"
    >
      <a
        hlmBtn
        variant="link"
        class="w-fit px-0"
        [routerLink]="['/orders', tenantId, storeId]"
        >← กลับกระดานออเดอร์</a
      >
      <span class="eyebrow text-xs font-semibold tracking-wide text-foreground"
        >ตรวจสอบการชำระเงิน</span
      >
      <h1
        class="m-0 text-2xl font-semibold leading-tight sm:text-3xl"
        id="review-title"
      >
        ตรวจสลิป PromptPay
      </h1>
      <p
        class="review-warning rounded-xl border border-preparing-line bg-preparing p-4 text-preparing-foreground"
      >
        ตรวจสอบยอดเงินเข้าจริงในบัญชีธนาคารของร้านทุกครั้งก่อนกดยืนยัน
        รูปสลิปอย่างเดียวไม่ใช่หลักฐานว่าได้รับเงินแล้ว
      </p>
      @if (error()) {
        <p
          class="review-error rounded-xl border border-destructive bg-danger-soft p-3 text-foreground"
          role="alert"
        >
          {{ error() }}
        </p>
      }
      @if (notice()) {
        <p role="status">{{ notice() }}</p>
      }
      <button
        hlmBtn
        type="button"
        (click)="refresh()"
        [disabled]="loading() || busy()"
      >
        {{ loading() ? "กำลังโหลด..." : "รีเฟรชคิวตรวจสลิป" }}
      </button>
      @if (allowed()) {
        <p class="review-muted text-sm text-muted-foreground">
          สลิปรอตรวจ {{ items().length }} รายการล่าสุด
        </p>
        @if (!loading() && !items().length) {
          <p>ขณะนี้ไม่มีสลิปที่รอการตรวจสอบ</p>
        }
        <div
          class="review-layout grid min-w-0 gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
        >
          <div class="review-list grid content-start gap-2">
            @for (item of items(); track item.slipId) {
              <button
                hlmBtn
                type="button"
                [variant]="
                  selected()?.slipId === item.slipId ? 'selected' : 'outline'
                "
                class="grid justify-items-start text-left"
                [class.is-selected]="selected()?.slipId === item.slipId"
                [disabled]="loading() || busy()"
                (click)="choose(item)"
              >
                <strong>Order {{ number(item.displayNumber) }}</strong>
                <span>{{ money(item.amountSatang) }} ฿</span>
                <small>ส่งเมื่อ {{ time(item.submittedAt) }}</small>
              </button>
            }
          </div>
          @if (selected(); as slip) {
            <section
              class="review-detail grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4"
              aria-labelledby="slip-heading"
            >
              <h2 class="text-lg font-semibold" id="slip-heading">
                ตรวจหลักฐานของ Order {{ number(slip.displayNumber) }}
              </h2>
              <p>
                <strong>ยอดที่ต้องรับ: {{ money(slip.amountSatang) }} ฿</strong>
              </p>
              @if (slip.imageAvailable !== false) {
                @for (imageSlip of [slip]; track selectionVersion()) {
                  <img
                    class="max-h-110 w-full max-w-85 rounded-lg bg-muted object-contain"
                    [src]="imageUrl()"
                    alt="สลิปที่ลูกค้าส่งเพื่อให้ร้านตรวจสอบยอดเงินจริง"
                    width="340"
                    (load)="readReference($event, imageSlip)"
                    (error)="imageUnavailable(imageSlip)"
                  />
                }
              } @else {
                <p role="status">
                  ภาพสลิปหมดอายุการจัดเก็บแล้ว ประวัติรายการยังคงอยู่
                  ตรวจสอบเงินเข้าจริงจากบัญชีร้านก่อนตัดสินใจ
                </p>
              }
              <p
                class="review-warning rounded-xl border border-preparing-line bg-preparing p-4 text-preparing-foreground"
              >
                เปรียบเทียบผู้รับเงิน จำนวนเงิน เวลา และรหัสธุรกรรม
                กับรายการเงินเข้าจริงในบัญชีร้าน กดยืนยันเฉพาะเมื่อข้อมูลตรงกัน
                ทั้งหมด ไม่ยืนยันจากรูปภาพหรือ QR อย่างเดียว
              </p>
              <label hlmLabel for="bank-ref"
                >รหัสอ้างอิงธุรกรรมจากธนาคาร *</label
              >
              <input
                hlmInput
                id="bank-ref"
                type="text"
                autocomplete="off"
                maxlength="64"
                [value]="bankReference()"
                (input)="editReference($any($event.target).value)"
                [disabled]="busy() || loading()"
                aria-describedby="reference-status"
                placeholder="รหัสธุรกรรมจากรายการเงินเข้า"
              />
              <p
                id="reference-status"
                role="status"
                class="text-sm text-muted-foreground"
              >
                @switch (scanState()) {
                  @case ("reading") {
                    กำลังอ่าน QR บนสลิป…
                  }
                  @case ("found") {
                    อ่านรหัสจาก QR บนสลิปแล้ว · ยังไม่ได้ตรวจสอบกับธนาคาร
                  }
                  @case ("unreadable") {
                    ไม่พบ QR สลิปที่อ่านได้ กรุณากรอกรหัสจากรายการเงินเข้าจริง
                  }
                  @case ("unavailable") {
                    ไม่สามารถอ่านภาพสลิปได้ กรุณากรอกรหัสจากรายการเงินเข้าจริง
                  }
                  @case ("manual") {
                    ใช้รหัสที่กรอกจากรายการเงินเข้าจริง
                  }
                }
              </p>
              <label hlmLabel for="actual-amount"
                >ยอดเงินเข้าที่ร้านจะยืนยัน (บาท) *</label
              >
              <input
                hlmInput
                id="actual-amount"
                inputmode="decimal"
                type="text"
                autocomplete="off"
                [value]="actualAmount()"
                (input)="actualAmount.set($any($event.target).value)"
                [disabled]="busy() || loading()"
                aria-describedby="amount-hint"
                placeholder="เช่น 120.00"
              />
              <p id="amount-hint" class="text-sm text-muted-foreground">
                ระบบเติมยอดตาม Order ให้ก่อน ไม่ใช่ยอดเงินที่ตรวจสอบจากธนาคาร
                หากไม่ตรงกับเงินเข้าจริง ให้แก้ไขและอย่ายืนยัน
              </p>
              @if (!amountMatches()) {
                <p class="text-sm text-destructive" role="status">
                  ยอดเงินไม่ตรงกับ Order ยังไม่สามารถยืนยันรับเงินได้
                </p>
              }
              <div class="review-actions flex flex-wrap gap-3">
                <button
                  hlmBtn
                  type="button"
                  class="review-confirm"
                  [disabled]="!canConfirm() || busy()"
                  (click)="decide('confirm')"
                >
                  ตรวจเงินเข้าแล้ว · ยืนยันรับเงิน
                </button>
                <button
                  hlmBtn
                  type="button"
                  variant="destructive"
                  class="review-reject"
                  [disabled]="busy() || loading()"
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
})
export class PaymentReviewPage implements OnInit, OnDestroy {
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
  readonly selectionVersion = signal(0);
  readonly scanState = signal<
    "reading" | "found" | "unreadable" | "unavailable" | "manual"
  >("unavailable");
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
  readonly amountMatches = computed(
    () =>
      (this.selected()?.amountSatang ?? 0) > 0 &&
      satangFromInput(this.actualAmount()) === this.selected()?.amountSatang,
  );
  readonly canConfirm = computed(
    () =>
      this.allowed() &&
      !this.loading() &&
      !this.busy() &&
      !!this.selected() &&
      /^[A-Za-z0-9._-]{6,64}$/.test(this.bankReference()) &&
      this.amountMatches(),
  );

  ngOnInit(): void {
    void this.refresh();
  }

  ngOnDestroy(): void {
    this.selectionVersion.update((value) => value + 1);
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
      this.replaceSelection(
        queue.items.find((s) => s.slipId === picked?.slipId) ?? null,
      );
    } catch {
      this.allowed.set(false);
      this.items.set([]);
      this.replaceSelection(null);
      this.error.set(
        "ไม่สามารถเปิดคิวตรวจสลิปได้ กรุณาตรวจสอบสิทธิ์และลองใหม่",
      );
    } finally {
      this.loading.set(false);
    }
  }

  private replaceSelection(item: PaymentSlipReview | null): void {
    const previous = this.selected();
    if (
      previous &&
      item &&
      previous.slipId === item.slipId &&
      previous.revision === item.revision &&
      previous.amountSatang === item.amountSatang &&
      previous.imageAvailable === item.imageAvailable
    ) {
      this.selected.set(item);
      return;
    }
    this.selectionVersion.update((value) => value + 1);
    this.selected.set(item);
    this.bankReference.set("");
    this.actualAmount.set(item ? (item.amountSatang / 100).toFixed(2) : "");
    this.scanState.set(
      item && item.imageAvailable !== false ? "reading" : "unavailable",
    );
  }

  choose(item: PaymentSlipReview): void {
    if (this.loading() || this.busy()) return;
    this.replaceSelection(item);
    this.notice.set("");
  }

  editReference(value: string): void {
    this.bankReference.set(value);
    this.scanState.set("manual");
  }

  imageUnavailable(item: PaymentSlipReview): void {
    if (
      this.selected()?.slipId === item.slipId &&
      this.selected()?.revision === item.revision &&
      this.scanState() === "reading"
    ) {
      this.scanState.set("unavailable");
    }
  }

  async readReference(event: Event, item: PaymentSlipReview): Promise<void> {
    if (
      this.selected()?.slipId !== item.slipId ||
      this.selected()?.revision !== item.revision ||
      this.scanState() !== "reading"
    ) {
      return;
    }
    const version = this.selectionVersion();
    const stillCurrent = () =>
      this.selectionVersion() === version && this.scanState() === "reading";
    try {
      const image = event.target as HTMLImageElement;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width < 1 || height < 1 || width > 2048 || height > 2048) {
        throw new Error("Invalid slip image");
      }
      const canvas = image.ownerDocument.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, width, height);
      const result = await decodeSlipReference(pixels.data, width, height);
      // An old image load or a manual edit must never fill another Order.
      if (!stillCurrent()) return;
      if (result) {
        this.bankReference.set(result.transactionReference);
        this.scanState.set("found");
      } else {
        this.scanState.set("unreadable");
      }
    } catch {
      if (stillCurrent()) this.scanState.set("unreadable");
    }
  }

  async decide(action: "confirm" | "reject"): Promise<void> {
    const item = this.selected();
    if (
      !item ||
      !this.allowed() ||
      this.loading() ||
      this.busy() ||
      (action === "confirm" && !this.canConfirm())
    ) {
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
              // Only the explicit "ตรวจเงินเข้าแล้ว" button reaches here.
              // This is merchant attestation, NOT decoder/bank verification.
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
      this.replaceSelection(null);
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
