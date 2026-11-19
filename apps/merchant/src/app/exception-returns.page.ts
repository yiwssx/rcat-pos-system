import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmCard } from "@spartan-ng/helm/card";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmLabel } from "@spartan-ng/helm/label";
import { InventoryApi } from "./inventory.api";
import {
  ExceptionReturnAllocation,
  ExceptionReturnCategory,
  ExceptionReturnRecord,
  ExceptionReturnView,
  formatUnits,
  validRecoverableReturnQuantity,
} from "./inventory.domain";
import { MerchantOrderApi } from "./merchant-order.api";
import { MerchantStore } from "./order-board.domain";

function failureMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่";
    if (error.status === 403 || error.status === 404) {
      return "ไม่มีสิทธิ์เข้าถึงออเดอร์หรือคำขอคืนสต็อกนี้";
    }
    if (error.status === 409) {
      return "ออเดอร์หรือยอดคงเหลือเปลี่ยนไป หรือผู้อนุมัติไม่เป็นอิสระ กรุณาโหลดข้อมูลล่าสุด";
    }
    if (error.status === 400) return "ปริมาณ หมวดหมู่ หรือเหตุผลไม่ถูกต้อง";
    if (error.status === 0) return "เครือข่ายขัดข้อง ตรวจสอบรายการก่อนลองซ้ำ";
  }
  return error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ";
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HlmBadge, HlmButton, HlmCard, HlmInput, HlmLabel],
  template: `
    <main
      class="mx-auto box-border w-full max-w-6xl space-y-5 px-4 pb-14 pt-6 sm:px-6 lg:px-8"
    >
      <a
        hlmBtn
        variant="link"
        class="min-h-11 px-0"
        [routerLink]="['/orders', tenantId, storeId]"
      >
        ← กลับไปกระดานออเดอร์
      </a>
      <span
        class="block text-xs font-semibold uppercase tracking-widest text-muted-foreground"
        >RCAT POS / CONTROLLED INVENTORY RETURN</span
      >
      <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
        คำขอคืนสต็อกหลังเริ่มปรุง
      </h1>
      <p class="text-sm leading-relaxed text-muted-foreground">
        {{ store()?.storeName || "กำลังตรวจสอบสิทธิ์ร้าน" }}
        · ออเดอร์ #{{ orderId.slice(0, 8) }}
      </p>
      <p
        class="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed"
        role="note"
      >
        <strong
          >คืนได้เฉพาะวัตถุดิบที่ยังไม่ถูกใช้และยังนำเข้าคลังได้จริง</strong
        >
        ห้ามคืนวัตถุดิบที่ปรุงแล้ว เสียหาย หรือปนเปื้อน
        การยื่นคำขอไม่เพิ่มสต็อกจนกว่า Owner/Manager อีกบัญชีจะตรวจสอบและอนุมัติ
        ระบบไม่ยกเลิกออเดอร์หรือคืนเงิน
      </p>

      @if (error()) {
        <div
          class="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-relaxed text-destructive"
          role="alert"
        >
          {{ error() }}
        </div>
      }
      @if (notice()) {
        <div
          class="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed"
          role="status"
        >
          {{ notice() }}
        </div>
      }
      @if (loading()) {
        <p class="text-sm leading-relaxed text-muted-foreground" role="status">
          กำลังอ่านยอดสต็อกจริง...
        </p>
      }
      @if (store() && view(); as data) {
        <div class="flex flex-wrap justify-end gap-3">
          <button
            hlmBtn
            class="min-h-11"
            type="button"
            [disabled]="busy()"
            (click)="reload()"
          >
            โหลดข้อมูลล่าสุด
          </button>
        </div>
        <p class="text-sm leading-relaxed text-muted-foreground">
          สถานะออเดอร์: {{ data.orderStatus }}
          · จำนวนที่คืนได้คำนวณจาก Allocation เดิม ไม่ใช่สูตรที่แก้ไขภายหลัง
        </p>
        @if (!data.eligible) {
          <p
            class="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed"
            role="status"
          >
            ออเดอร์นี้ยังไม่อยู่ในขั้นตอนกำลังเตรียมหรือเสิร์ฟแล้ว
            จึงไม่สามารถขอคืนสต็อกกรณีพิเศษได้
          </p>
        }
        <div class="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <section
            hlmCard
            size="sm"
            class="min-w-0 gap-4 p-4 sm:p-5"
            aria-labelledby="exception-allocation-title"
          >
            <h2 id="exception-allocation-title" class="text-lg font-semibold">
              วัตถุดิบที่ตัดตามออเดอร์
            </h2>
            @if (data.allocations.length === 0) {
              <p class="text-sm leading-relaxed text-muted-foreground">
                ออเดอร์นี้ไม่ได้ตัดสต็อกที่ติดตามไว้ จึงไม่มีวัตถุดิบให้คืน
              </p>
            }
            @for (item of data.allocations; track item.itemId) {
              <article hlmCard size="sm" class="min-w-0 gap-3 p-4">
                <h3 class="break-words font-semibold">{{ item.itemName }}</h3>
                <p class="text-sm leading-relaxed text-muted-foreground">
                  ตัด {{ formatQuantity(item.allocated) }} {{ item.unit }} ·
                  คืนแล้ว {{ formatQuantity(item.alreadyReturned) }} ·
                  คืนเพิ่มได้สูงสุด {{ formatQuantity(item.remaining) }}
                </p>
              </article>
            }
          </section>

          @if (data.eligible && mayManage()) {
            <section
              hlmCard
              size="sm"
              class="min-w-0 gap-4 p-4 sm:p-5"
              aria-labelledby="exception-request-title"
            >
              <h2 id="exception-request-title" class="text-lg font-semibold">
                ยื่นคำขอคืนวัตถุดิบที่ยังไม่ใช้
              </h2>
              <form class="grid min-w-0 gap-4" (submit)="submit($event)">
                <label hlmLabel class="grid min-w-0 gap-2 text-sm font-medium"
                  >วัตถุดิบ
                  <select
                    class="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    [value]="itemId()"
                    (change)="selectItem($event)"
                    required
                  >
                    <option value="">เลือกจากรายการที่ยังคืนได้</option>
                    @for (item of available(); track item.itemId) {
                      <option [value]="item.itemId">
                        {{ item.itemName }} (สูงสุด
                        {{ formatQuantity(item.remaining) }})
                      </option>
                    }
                  </select>
                </label>
                <label hlmLabel class="grid min-w-0 gap-2 text-sm font-medium"
                  >ปริมาณที่ยังไม่ใช้ (g / ml / ชิ้น)
                  <input
                    hlmInput
                    class="min-h-11 w-full"
                    type="text"
                    inputmode="decimal"
                    required
                    placeholder="เช่น 0.500"
                    [value]="quantity()"
                    (input)="setValue($event, 'quantity')"
                  />
                </label>
                <label hlmLabel class="grid min-w-0 gap-2 text-sm font-medium"
                  >เหตุผลที่นำกลับเข้าคลังได้
                  <select
                    class="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    [value]="category()"
                    (change)="selectCategory($event)"
                  >
                    <option value="unused_unopened">
                      ยังไม่เปิดใช้ / ยังไม่แกะบรรจุภัณฑ์
                    </option>
                    <option value="kitchen_error_unconsumed">
                      ครัวเตรียมเกิน แต่ยังไม่ถูกใช้หรือปนเปื้อน
                    </option>
                  </select>
                </label>
                <label hlmLabel class="grid min-w-0 gap-2 text-sm font-medium"
                  >รายละเอียดหลักฐานการตรวจสอบ (10–200 ตัวอักษร)
                  <input
                    hlmInput
                    class="min-h-11 w-full"
                    type="text"
                    minlength="10"
                    maxlength="200"
                    required
                    placeholder="ระบุสภาพและเหตุผลที่ยังใช้ได้"
                    [value]="reason()"
                    (input)="setValue($event, 'reason')"
                  />
                </label>
                <button
                  hlmBtn
                  class="min-h-11"
                  type="submit"
                  [disabled]="busy() || !available().length"
                >
                  ส่งคำขอให้ผู้อนุมัติอีกบัญชี
                </button>
              </form>
            </section>
          }
        </div>

        <section
          hlmCard
          size="sm"
          class="min-w-0 gap-4 p-4 sm:p-5"
          aria-labelledby="exception-history-title"
        >
          <h2 id="exception-history-title" class="text-lg font-semibold">
            ประวัติคำขอและการตรวจสอบ
          </h2>
          @if (!data.requests.length) {
            <p class="text-sm leading-relaxed text-muted-foreground">
              ยังไม่มีคำขอคืนสต็อกกรณีพิเศษ
            </p>
          }
          <div class="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            @for (entry of data.requests; track entry.requestId) {
              <article hlmCard size="sm" class="min-w-0 gap-3 p-4">
                <div
                  class="flex min-w-0 flex-wrap items-start justify-between gap-3"
                >
                  <h3 class="break-words font-semibold">
                    {{ itemName(entry.itemId) }}
                  </h3>
                  <span hlmBadge variant="outline">{{
                    statusLabel(entry.state)
                  }}</span>
                </div>
                <p class="text-sm leading-relaxed text-muted-foreground">
                  {{ formatQuantity(entry.quantity) }} · {{ entry.reason }}
                </p>
                <p class="text-sm leading-relaxed text-muted-foreground">
                  ผู้ขอ: {{ entry.createdBy.slice(0, 8) }} · ผู้ตัดสิน:
                  {{ entry.reviewedBy?.slice(0, 8) || "—" }}
                </p>
                @if (entry.state === "pending" && mayManage()) {
                  <div class="flex flex-wrap gap-3">
                    <button
                      hlmBtn
                      class="min-h-11"
                      type="button"
                      [disabled]="busy()"
                      (click)="review(entry, true)"
                    >
                      อนุมัติคืนเข้าสต็อก
                    </button>
                    <button
                      hlmBtn
                      class="min-h-11"
                      type="button"
                      variant="outline"
                      [disabled]="busy()"
                      (click)="review(entry, false)"
                    >
                      ปฏิเสธคำขอ
                    </button>
                  </div>
                }
              </article>
            }
          </div>
        </section>
      }
    </main>
  `,
})
export class ExceptionReturnsPage implements OnInit {
  private readonly inventory = inject(InventoryApi);
  private readonly merchant = inject(MerchantOrderApi);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  readonly tenantId = this.route.snapshot.paramMap.get("tenantId") ?? "";
  readonly storeId = this.route.snapshot.paramMap.get("storeId") ?? "";
  readonly orderId = this.route.snapshot.paramMap.get("orderId") ?? "";
  readonly store = signal<MerchantStore | null>(null);
  readonly view = signal<ExceptionReturnView | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly itemId = signal("");
  readonly quantity = signal("");
  readonly reason = signal("");
  readonly category = signal<ExceptionReturnCategory>("unused_unopened");
  readonly formatQuantity = formatUnits;
  private retry: { itemId: string; key: string; payload: string } | null = null;

  readonly available = () =>
    (this.view()?.allocations ?? []).filter(
      (entry) =>
        validRecoverableReturnQuantity("0.001", entry.remaining) &&
        !this.view()?.requests.some(
          (request) =>
            request.itemId === entry.itemId && request.state === "pending",
        ),
    );
  readonly mayManage = () =>
    this.store()?.role === "owner" || this.store()?.role === "manager";

  statusLabel(state: ExceptionReturnRecord["state"]): string {
    return {
      pending: "รอผู้อนุมัติ",
      approved: "คืนสต็อกแล้ว",
      rejected: "ปฏิเสธ",
    }[state];
  }
  itemName(id: string): string {
    return (
      this.view()?.allocations.find((entry) => entry.itemId === id)?.itemName ??
      "วัตถุดิบ"
    );
  }

  ngOnInit(): void {
    void this.initialize();
  }
  private async initialize(): Promise<void> {
    try {
      const { stores } = await this.merchant.stores();
      const found = stores.find(
        (item) =>
          item.tenantId === this.tenantId &&
          item.storeId === this.storeId &&
          (item.role === "owner" || item.role === "manager"),
      );
      if (!found) throw new Error("ต้องเป็น Owner หรือ Manager ของร้านนี้");
      this.store.set(found);
      await this.reload();
    } catch (error) {
      this.error.set(failureMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
  async reload(): Promise<void> {
    if (!this.store()) return;
    this.loading.set(true);
    this.error.set("");
    try {
      this.view.set(
        await this.inventory.exceptionReturnView(
          this.tenantId,
          this.storeId,
          this.orderId,
        ),
      );
    } catch (error) {
      this.error.set(failureMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
  selectItem(event: Event): void {
    if (event.target instanceof HTMLSelectElement)
      this.itemId.set(event.target.value);
  }
  selectCategory(event: Event): void {
    if (
      event.target instanceof HTMLSelectElement &&
      (event.target.value === "unused_unopened" ||
        event.target.value === "kitchen_error_unconsumed")
    ) {
      this.category.set(event.target.value);
    }
  }
  setValue(event: Event, field: "quantity" | "reason"): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (field === "quantity") this.quantity.set(event.target.value);
    else this.reason.set(event.target.value);
  }
  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.mayManage() || !this.view()?.eligible) return;
    const chosen: ExceptionReturnAllocation | undefined = this.available().find(
      (item) => item.itemId === this.itemId(),
    );
    const quantity = this.quantity();
    const reason = this.reason().trim();
    if (
      !chosen ||
      !validRecoverableReturnQuantity(quantity, chosen.remaining) ||
      reason.length < 10 ||
      reason.length > 200
    ) {
      this.error.set("ตรวจสอบวัตถุดิบ ปริมาณ และเหตุผลให้ถูกต้อง");
      return;
    }
    try {
      const crypto = this.document.defaultView?.crypto;
      if (!crypto?.randomUUID)
        throw new Error("อุปกรณ์ไม่รองรับ UUID ที่ปลอดภัย");
      const payload = [chosen.itemId, quantity, this.category(), reason].join(
        "|",
      );
      if (!this.retry || this.retry.payload !== payload) {
        this.retry = {
          itemId: chosen.itemId,
          key: crypto.randomUUID(),
          payload,
        };
      }
      this.busy.set(true);
      this.error.set("");
      await this.inventory.requestExceptionReturn(
        this.tenantId,
        this.storeId,
        this.orderId,
        {
          itemId: chosen.itemId,
          idempotencyKey: this.retry.key,
          quantity,
          category: this.category(),
          reason,
        },
      );
      this.retry = null;
      this.itemId.set("");
      this.quantity.set("");
      this.reason.set("");
      this.notice.set("บันทึกคำขอแล้ว รอการตรวจสอบโดย Owner/Manager อีกบัญชี");
      await this.reload();
    } catch (error) {
      this.error.set(failureMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  async review(entry: ExceptionReturnRecord, approve: boolean): Promise<void> {
    if (this.busy() || !this.mayManage() || entry.state !== "pending") return;
    const decision = approve ? "อนุมัติคืนวัตถุดิบที่ยังไม่ใช้" : "ปฏิเสธคำขอ";
    if (
      !this.document.defaultView?.confirm(
        `ยืนยัน${decision} ปริมาณ ${entry.quantity} หรือไม่?\nการอนุมัติจะเพิ่มสต็อกทันที แต่ไม่เปลี่ยนสถานะออเดอร์/Payment`,
      )
    )
      return;
    this.busy.set(true);
    this.error.set("");
    try {
      await this.inventory.reviewExceptionReturn(
        this.tenantId,
        this.storeId,
        entry.requestId,
        approve,
      );
      this.notice.set(
        approve
          ? "อนุมัติและคืนเข้าคลังแล้ว ระบบบันทึก Stock Movement และ Audit"
          : "ปฏิเสธแล้ว ยอดสต็อกไม่เปลี่ยนแปลง",
      );
      await this.reload();
    } catch (error) {
      this.error.set(failureMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
