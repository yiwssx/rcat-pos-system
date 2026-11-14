import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import {
  MerchantOrderApi,
  PromptPayReceiverSettings,
} from "./merchant-order.api";

type ReceiverKind = "mobile" | "national_id";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: "./merchant-payment-receiver.page.html",
  styleUrls: ["./merchant-payment-receiver.css"],
})
export class MerchantPaymentReceiverPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(MerchantOrderApi);

  readonly tenantId = this.route.snapshot.paramMap.get("tenantId") ?? "";
  readonly storeId = this.route.snapshot.paramMap.get("storeId") ?? "";
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly authorized = signal(false);
  readonly current = signal<PromptPayReceiverSettings | null>(null);
  readonly receiverKind = signal<ReceiverKind>("mobile");
  readonly receiverId = signal("");
  readonly error = signal("");
  readonly notice = signal("");
  readonly valid = computed(() => {
    const id = this.receiverId();
    return this.receiverKind() === "mobile"
      ? /^0[689][0-9]{8}$/.test(id)
      : /^[0-9]{13}$/.test(id);
  });

  ngOnInit(): void {
    void this.reload();
  }

  onKindChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value !== "mobile" && value !== "national_id") return;
    this.receiverKind.set(value);
    this.receiverId.set("");
    this.notice.set("");
  }

  onIdInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const maxLength = this.receiverKind() === "mobile" ? 10 : 13;
    const normalized = input.value.replace(/[^0-9]/g, "").slice(0, maxLength);
    input.value = normalized;
    this.receiverId.set(normalized);
    this.notice.set("");
  }

  async reload(): Promise<void> {
    if (this.busy()) return;
    this.loading.set(true);
    this.error.set("");
    try {
      const { stores } = await this.api.stores();
      const allowed = stores.some(
        (store) =>
          store.tenantId === this.tenantId &&
          store.storeId === this.storeId &&
          (store.role === "owner" || store.role === "manager"),
      );
      this.authorized.set(allowed);
      if (!allowed) {
        this.current.set(null);
        this.error.set("เฉพาะเจ้าของร้านและผู้จัดการเท่านั้น");
        return;
      }
      const settings = await this.api.receiverSettings(
        this.tenantId,
        this.storeId,
      );
      this.current.set(settings);
      if (
        settings.receiverKind === "mobile" ||
        settings.receiverKind === "national_id"
      ) {
        this.receiverKind.set(settings.receiverKind);
      }
    } catch {
      this.current.set(null);
      this.error.set("ไม่สามารถโหลดบัญชีรับเงินได้ กรุณาลองใหม่");
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    const current = this.current();
    if (!this.authorized() || !current || this.busy() || !this.valid()) return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      const saved = await this.api.configureReceiver(
        this.tenantId,
        this.storeId,
        {
          receiverKind: this.receiverKind(),
          receiverId: this.receiverId(),
          expectedRevision: current.revision,
        },
      );
      this.current.set(saved);
      this.receiverId.set("");
      this.notice.set(
        "บันทึกบัญชีรับเงินแล้ว แต่ยังไม่เปิดรับชำระเงิน " +
          "ผู้ดูแลต้องตรวจสอบบัญชีและอนุมัติแยกต่างหาก",
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "status" in error
          ? (error as { status: unknown }).status
          : null;
      this.error.set(
        code === 409
          ? "ข้อมูลบัญชีมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุดแล้วกรอกใหม่"
          : "บันทึกไม่สำเร็จ กรุณาตรวจรูปแบบและสิทธิ์การเข้าถึง",
      );
    } finally {
      this.busy.set(false);
    }
  }
}
