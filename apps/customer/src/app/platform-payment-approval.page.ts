import { DOCUMENT } from "@angular/common";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { firstValueFrom } from "rxjs";
import { PortalSession } from "./portal-session.service";

type ReviewAction = "approve" | "reject" | "revoke";
type ReviewStatus = "pending" | "approved" | "rejected" | "revoked";
interface Receiver {
  tenantId: string;
  storeId: string;
  tenantName: string;
  storeName: string;
  receiverKind: "mobile" | "national_id";
  maskedReceiver: string;
  revision: number;
  enabled: boolean;
  retentionReady: boolean;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
}
interface ApprovalAdmin {
  userId: string;
  email: string;
  allowed: boolean;
}
interface Overview {
  canReview: boolean;
  isSuper: boolean;
  policyApproved: boolean;
  releaseReady: boolean;
  items: Receiver[];
  admins: ApprovalAdmin[];
}

const API = "/api/platform/payments";
const REF = /^[A-Za-z0-9_./:#-]{8,120}$/;
const ACTION_LABEL: Record<ReviewAction, string> = {
  approve: "อนุมัติบัญชี",
  reject: "ไม่อนุมัติ",
  revoke: "เพิกถอนและระงับ",
};
const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "รอตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  revoked: "ถูกระงับ",
};

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HlmButton, HlmInput],
  template: `
    <section
      class="mx-auto grid max-w-6xl min-w-0 gap-4"
      aria-labelledby="payment-admin-heading"
    >
      <header
        class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-action p-5 text-action-foreground"
      >
        <div>
          <h1 id="payment-admin-heading" class="text-2xl font-semibold">
            อนุมัติบัญชีรับเงิน
          </h1>
          <p class="mt-1 text-sm">
            ตรวจสอบบัญชี PromptPay ก่อนอนุญาตให้ร้านเปิดรับชำระเงิน
          </p>
        </div>
        <a hlmBtn variant="outline" routerLink="/platform">จัดการผู้ใช้งาน</a>
      </header>
      @if (error()) {
        <p
          class="rounded-xl bg-danger-soft p-3 text-sm text-foreground"
          role="alert"
        >
          {{ error() }}
        </p>
      }
      @if (notice()) {
        <p
          class="rounded-xl bg-served p-3 text-sm text-served-foreground"
          role="status"
        >
          {{ notice() }}
        </p>
      }
      <div class="flex flex-wrap items-center justify-between gap-2">
        <button
          hlmBtn
          variant="outline"
          type="button"
          [disabled]="loading() || busy()"
          (click)="load()"
        >
          รีเฟรชรายการ
        </button>
        @if (loading()) {
          <span role="status" class="text-sm">กำลังโหลดข้อมูล…</span>
        }
      </div>
      @if (data(); as view) {
        <section
          class="grid gap-3 rounded-xl border border-border bg-card p-4"
          aria-label="นโยบายการอนุมัติ"
        >
          <h2 class="font-semibold">สถานะการอนุมัติ</h2>
          <p class="text-sm">
            {{
              view.releaseReady
                ? "ระบบอนุญาตฟังก์ชัน QR และสลิปแล้ว"
                : "ระบบยังไม่อนุญาตการรับเงินจริง"
            }}
          </p>
          <p class="text-sm">
            {{
              view.policyApproved
                ? "นโยบายอนุมัติบัญชีใหม่: เปิด"
                : "นโยบายอนุมัติบัญชีใหม่: ปิด"
            }}
          </p>
          @if (view.isSuper) {
            <p class="text-sm text-muted-foreground">
              อนุญาตเมื่อยืนยันแผนรับเงินจริงแบบจำกัดวง การปกป้องข้อมูล
              การสำรองและกู้คืน และนโยบายสลิป 90 วันแล้ว
              การพักนโยบายจะหยุดการอนุมัติใหม่เท่านั้น
              ไม่ยกเลิกรายการรับเงินเดิม
            </p>
            <form
              class="grid gap-2"
              (submit)="changePolicy($event, !view.policyApproved, policyRef)"
            >
              <label for="payment-policy-ref" class="text-sm font-medium"
                >รหัสอ้างอิงการอนุมัติหรือระงับนโยบาย
                (ไม่ใส่ข้อมูลส่วนบุคคล)</label
              >
              <input
                hlmInput
                id="payment-policy-ref"
                #policyRef
                maxlength="120"
                required
                autocomplete="off"
                placeholder="เช่น G6-policy-001"
                [disabled]="busy() || loading()"
              />
              <button
                hlmBtn
                type="submit"
                class="w-fit"
                [disabled]="
                  busy() ||
                  loading() ||
                  (!view.policyApproved && !view.releaseReady)
                "
              >
                {{
                  view.policyApproved
                    ? "พักการอนุมัติใหม่"
                    : "ยืนยันนโยบายและอนุญาตการอนุมัติ"
                }}
              </button>
            </form>
          }
        </section>
        @if (view.isSuper) {
          <section
            class="grid gap-3 rounded-xl border border-border bg-card p-4"
            aria-label="สิทธิ์ผู้อนุมัติ"
          >
            <h2 class="font-semibold">มอบหมายสิทธิ์อนุมัติบัญชี</h2>
            <p class="text-sm text-muted-foreground">
              เฉพาะ Admin ที่ได้รับมอบหมาย การระงับหรือเปลี่ยนบัญชี Admin
              จะยกเลิกสิทธิ์นี้
            </p>
            @for (admin of view.admins; track admin.userId) {
              <div
                class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
              >
                <div class="min-w-0 break-all text-sm">
                  {{ admin.email }}
                  <p class="text-muted-foreground">
                    {{
                      admin.allowed
                        ? "มีสิทธิ์อนุมัติ"
                        : "ยังไม่มีสิทธิ์อนุมัติ"
                    }}
                  </p>
                </div>
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  [disabled]="busy() || loading()"
                  (click)="grant(admin)"
                >
                  {{ admin.allowed ? "ถอนสิทธิ์" : "มอบหมายสิทธิ์" }}
                </button>
              </div>
            } @empty {
              <p class="text-sm text-muted-foreground">
                ยังไม่มีบัญชี Admin ที่ใช้งานอยู่
              </p>
            }
          </section>
        }
        @if (!view.canReview) {
          <p class="rounded-xl border border-border bg-card p-4 text-sm">
            กรุณาขอสิทธิ์อนุมัติบัญชีรับเงินจาก Super Admin
          </p>
        } @else {
          <section class="grid gap-3" aria-label="รายการบัญชี PromptPay">
            <h2 class="text-lg font-semibold">บัญชีรับเงินของร้านค้า</h2>
            @for (item of view.items; track item.storeId) {
              <article
                class="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0 break-words">
                    <h3 class="font-semibold">{{ item.storeName }}</h3>
                    <p class="text-sm text-muted-foreground">
                      {{ item.tenantName }}
                    </p>
                  </div>
                  <span
                    class="rounded-lg bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground"
                    >{{ statuses[item.reviewStatus] }}</span
                  >
                </div>
                <p class="text-sm">
                  {{
                    item.receiverKind === "mobile"
                      ? "เบอร์โทรศัพท์"
                      : "เลขประจำตัวประชาชน/ผู้เสียภาษี"
                  }}
                  {{ item.maskedReceiver }} · รุ่น {{ item.revision }}
                </p>
                <p class="text-sm text-muted-foreground">
                  {{
                    item.enabled
                      ? "ร้านเปิดรับเงินอยู่"
                      : "ร้านยังไม่เปิดรับเงิน"
                  }}
                  ·
                  {{
                    item.retentionReady
                      ? "กำหนดเก็บสลิป 90 วัน"
                      : "ยังไม่กำหนดนโยบายสลิป"
                  }}
                </p>
                @if (item.reviewedBy && item.reviewedAt) {
                  <p class="break-words text-sm text-muted-foreground">
                    ผู้ตรวจสอบ: {{ item.reviewedBy }} ·
                    {{ date(item.reviewedAt) }}
                  </p>
                }
                <div class="flex flex-wrap gap-2">
                  @if (!item.enabled && item.reviewStatus !== "approved") {
                    <button
                      hlmBtn
                      type="button"
                      [disabled]="
                        busy() ||
                        loading() ||
                        !view.releaseReady ||
                        !view.policyApproved
                      "
                      (click)="begin(item, 'approve')"
                    >
                      อนุมัติ
                    </button>
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      [disabled]="busy() || loading()"
                      (click)="begin(item, 'reject')"
                    >
                      ไม่อนุมัติ
                    </button>
                  } @else {
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      [disabled]="busy() || loading()"
                      (click)="begin(item, 'revoke')"
                    >
                      เพิกถอนและระงับ
                    </button>
                  }
                </div>
                @if (review(); as selected) {
                  @if (selected.item.storeId === item.storeId) {
                    <form
                      class="grid gap-3 rounded-xl border border-border bg-muted p-3"
                      (submit)="submitReview($event, selected, ref, verified)"
                    >
                      <h4 class="font-semibold">
                        {{ actions[selected.action] }} — {{ item.storeName }}
                      </h4>
                      @if (selected.action === "approve") {
                        <p class="text-sm">
                          ตรวจสอบเจ้าของบัญชีจากหลักฐานธนาคารจริงโดยอิสระ
                          แล้วกรอกหมายเลข PromptPay
                          ที่ตรวจสอบแล้วเพื่อเทียบกับบัญชีของร้าน
                          ห้ามใช้เพียงสลิปหรือเลขท้ายเป็นหลักฐาน
                        </p>
                      } @else {
                        <p class="text-sm">
                          การดำเนินการนี้จะระงับการเปิดรับเงินของบัญชีรุ่นนี้
                          โดยไม่ลบประวัติการชำระเงิน
                        </p>
                      }
                      <label
                        for="payment-review-ref"
                        class="text-sm font-medium"
                        >รหัสอ้างอิงการตรวจสอบ (ไม่ใส่ข้อมูลส่วนบุคคล)</label
                      >
                      <input
                        hlmInput
                        id="payment-review-ref"
                        #ref
                        required
                        maxlength="120"
                        autocomplete="off"
                        [disabled]="busy()"
                      />
                      <div
                        [hidden]="selected.action !== 'approve'"
                        class="space-y-2"
                      >
                        <label
                          for="payment-verified-id"
                          class="text-sm font-medium"
                          >หมายเลข PromptPay ที่ตรวจสอบจากธนาคาร</label
                        >
                        <input
                          hlmInput
                          id="payment-verified-id"
                          #verified
                          type="password"
                          inputmode="numeric"
                          autocomplete="off"
                          maxlength="13"
                          [required]="selected.action === 'approve'"
                          [disabled]="busy() || selected.action !== 'approve'"
                        />
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <button
                          hlmBtn
                          type="submit"
                          [disabled]="
                            busy() ||
                            loading() ||
                            (selected.action === 'approve' &&
                              (!view.policyApproved || !view.releaseReady))
                          "
                        >
                          ยืนยัน{{ actions[selected.action] }}
                        </button>
                        <button
                          hlmBtn
                          variant="outline"
                          type="button"
                          [disabled]="busy()"
                          (click)="review.set(null)"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </form>
                  }
                }
              </article>
            } @empty {
              <p
                class="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"
              >
                ไม่มีบัญชีในหน้านี้
              </p>
            }
            <div class="flex flex-wrap gap-2">
              @if (cursor()) {
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  [disabled]="busy() || loading()"
                  (click)="load()"
                >
                  หน้าแรก
                </button>
              }
              @if (view.items.length === 50) {
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  [disabled]="busy() || loading()"
                  (click)="next()"
                >
                  หน้าถัดไป
                </button>
              }
            </div>
          </section>
        }
      }
    </section>
  `,
})
export class PlatformPaymentApprovalPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(PortalSession);
  readonly data = signal<Overview | null>(null);
  readonly cursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly review = signal<{ item: Receiver; action: ReviewAction } | null>(
    null,
  );
  readonly actions = ACTION_LABEL;
  readonly statuses = STATUS_LABEL;

  ngOnInit(): void {
    void this.load();
  }

  date(value: string): string {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok",
    }).format(new Date(value));
  }

  private headers(): Record<string, string> {
    const matches = this.document.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("__Host-rcat_csrf="));
    const token = matches[0]?.slice("__Host-rcat_csrf=".length) ?? "";
    if (matches.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error("Invalid session");
    }
    return { "X-CSRF-Token": token };
  }

  private fail(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        this.session.expire();
        this.error.set("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
        return;
      }
      if (error.status === 409) {
        this.error.set("บัญชีรับเงินเปลี่ยนแปลงแล้ว กรุณาตรวจสอบรายการล่าสุด");
        return;
      }
      if (error.status === 403) {
        this.error.set(
          "ไม่มีสิทธิ์ นโยบายยังไม่พร้อม หรือหมายเลขบัญชีไม่ตรงกับที่ตรวจสอบ",
        );
        return;
      }
    }
    this.error.set("ดำเนินการไม่สำเร็จ กรุณาโหลดข้อมูลใหม่ก่อนลองอีกครั้ง");
  }

  async load(after: string | null = null): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set("");
    this.review.set(null);
    this.data.set(null);
    this.cursor.set(after);
    try {
      this.data.set(
        await firstValueFrom(
          this.http.get<Overview>(API, {
            params: after ? { after } : {},
            withCredentials: true,
          }),
        ),
      );
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading.set(false);
    }
  }

  next(): void {
    const last = this.data()?.items.at(-1);
    if (last) void this.load(last.storeId);
  }

  begin(item: Receiver, action: ReviewAction): void {
    this.error.set("");
    this.notice.set("");
    this.review.set({ item, action });
  }

  private async mutate(path: string, body: object): Promise<void> {
    if (this.busy() || this.loading()) return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    this.review.set(null);
    try {
      await firstValueFrom(
        this.http.post(API + path, body, {
          headers: this.headers(),
          withCredentials: true,
        }),
      );
      await this.load(this.cursor());
      if (this.data()) this.notice.set("บันทึกการดำเนินการแล้ว");
    } catch (error) {
      await this.load(this.cursor());
      this.fail(error);
    } finally {
      this.busy.set(false);
    }
  }

  grant(admin: ApprovalAdmin): void {
    void this.mutate("/grants/" + encodeURIComponent(admin.userId), {
      allowed: !admin.allowed,
    });
  }

  changePolicy(event: Event, approved: boolean, input: HTMLInputElement): void {
    event.preventDefault();
    const approvalRef = input.value.trim();
    if (!REF.test(approvalRef)) {
      this.error.set(
        "กรอกรหัสอ้างอิง 8–120 ตัวอักษรภาษาอังกฤษ ตัวเลข หรือ - _ / . : #",
      );
      return;
    }
    input.value = "";
    void this.mutate("/policy", { approved, approvalRef });
  }

  submitReview(
    event: Event,
    selected: { item: Receiver; action: ReviewAction },
    ref: HTMLInputElement,
    verified: HTMLInputElement,
  ): void {
    event.preventDefault();
    const approvalRef = ref.value.trim();
    const verifiedReceiverId =
      selected.action === "approve" ? verified.value.trim() : null;
    verified.value = "";
    if (
      !REF.test(approvalRef) ||
      (verifiedReceiverId !== null &&
        !/^(?:0[689][0-9]{8}|[0-9]{13})$/.test(verifiedReceiverId))
    ) {
      this.error.set("ตรวจสอบรหัสอ้างอิงและหมายเลข PromptPay ที่ยืนยันแล้ว");
      return;
    }
    ref.value = "";
    const path =
      "/receivers/" +
      encodeURIComponent(selected.item.tenantId) +
      "/" +
      encodeURIComponent(selected.item.storeId) +
      "/review";
    void this.mutate(path, {
      action: selected.action,
      approvalRef,
      expectedRevision: selected.item.revision,
      verifiedReceiverId,
    });
  }
}
