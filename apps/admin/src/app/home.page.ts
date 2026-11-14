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
import { ActivatedRoute, RouterLink } from "@angular/router";
import { OwnerAdminApi } from "./owner-admin.api";
import {
  AdminStore,
  MerchantCreation,
  STAFF_ROLE_LABEL,
  validInvitationToken,
  validMerchantCreation,
} from "./owner-admin.domain";

function failure(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401)
      return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบด้วย Google Workspace";
    if (error.status === 403 || error.status === 404) {
      return "ไม่มีสิทธิ์ดำเนินการนี้ หรือรายการหมดอายุแล้ว";
    }
    if (error.status === 409) return "รหัสหน่วยงานหรือร้านค้านี้ถูกใช้แล้ว";
    if (error.status === 400) return "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";
    if (error.status === 0)
      return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่";
  }
  return error instanceof Error ? error.message : "เกิดข้อผิดพลาด กรุณาลองใหม่";
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrls: ["./owner-admin.css"],
  template: `
    <div class="owner-shell">
      <header class="owner-intro">
        <span class="eyebrow">ADMINISTRATION / RCAT POS</span>
        <h1>จัดการร้านค้าและบัญชีบุคลากร</h1>
        <p class="owner-muted">
          พื้นที่บริหารร้านที่บัญชีนี้ได้รับสิทธิ์เท่านั้น
          ไม่ใช่สิทธิ์ผู้ดูแลทุก Tenant ของแพลตฟอร์ม
        </p>
        @if (!unified) {
          <div class="owner-session">
            <a href="/api/auth/google/start" class="owner-login">
              เข้าสู่ระบบด้วย Google Workspace @rcat.ac.th
            </a>
            @if (authenticated()) {
              <button
                type="button"
                class="owner-logout"
                (click)="logout()"
                [disabled]="pending()"
              >
                ออกจากระบบ
              </button>
            }
          </div>
        }
        <p class="owner-alert" role="note">
          การสร้างร้านและจัดการพนักงานมีผลเมื่อระบบยืนยันเท่านั้น ·
          ยังไม่เปิดรับชำระเงิน
        </p>
      </header>

      @if (loading()) {
        <p class="owner-state" role="status">
          กำลังตรวจสอบสิทธิ์ร้านค้าของบัญชี...
        </p>
      }
      @if (error()) {
        <div class="owner-error" role="alert">
          {{ error() }}
          <button type="button" (click)="loadStores()" [disabled]="loading()">
            ลองใหม่
          </button>
        </div>
      }
      @if (notice()) {
        <p class="owner-success" role="status">{{ notice() }}</p>
      }

      @if (authenticated()) {
        <section aria-labelledby="owner-stores-title" class="owner-panel">
          <div class="owner-headline">
            <h2 id="owner-stores-title">ร้านที่เข้าถึงได้</h2>
            <button
              type="button"
              (click)="loadStores()"
              [disabled]="loading() || pending()"
            >
              โหลดข้อมูลล่าสุด
            </button>
          </div>
          @if (stores().length === 0) {
            <p class="owner-muted">
              บัญชีนี้ยังไม่มีร้านค้า หรือยังไม่ได้รับคำเชิญจากเจ้าของร้าน
            </p>
          } @else {
            <div class="owner-stores">
              @for (store of stores(); track store.tenantId + store.storeId) {
                <article>
                  <small>{{ store.tenantName }}</small>
                  <h3>{{ store.storeName }}</h3>
                  <span class="owner-role">{{ roleLabel[store.role] }}</span>
                  @if (store.role === "owner") {
                    <a [routerLink]="['/tenants', store.tenantId, 'staff']">
                      จัดการบุคลากรและคำเชิญ
                    </a>
                  } @else {
                    <span class="owner-muted"
                      >การจัดการสิทธิ์ต้องใช้บัญชีเจ้าของร้าน</span
                    >
                  }
                </article>
              }
            </div>
          }
        </section>

        <div class="owner-grid v6-owner-actions">
          <details
            class="owner-panel v6-owner-disclosure"
            aria-labelledby="create-title"
          >
            <summary>
              <strong id="create-title">สร้างร้านใหม่</strong>
              <span>สร้างร้านและหน่วยงานสำหรับบัญชีที่ได้รับสิทธิ์</span>
            </summary>
            <div class="v6-owner-form-body">
              <p class="owner-muted">
                เปิดเฉพาะบัญชีที่ได้รับอนุมัติแล้ว จำกัดจำนวนร้านตาม Backend
              </p>
              <form (submit)="create($event)" class="owner-form">
                <label
                  >รหัสหน่วยงาน (ภาษาอังกฤษ)
                  <input
                    name="tenantSlug"
                    type="text"
                    autocomplete="off"
                    [value]="tenantSlug()"
                    (input)="field($event, 'tenantSlug')"
                    placeholder="rcat-demo"
                    maxlength="48"
                    required
                  />
                </label>
                <label
                  >ชื่อหน่วยงาน
                  <input
                    name="tenantName"
                    type="text"
                    autocomplete="organization"
                    [value]="tenantName()"
                    (input)="field($event, 'tenantName')"
                    maxlength="160"
                    required
                  />
                </label>
                <label
                  >รหัสร้าน (ภาษาอังกฤษ)
                  <input
                    name="storeSlug"
                    type="text"
                    autocomplete="off"
                    [value]="storeSlug()"
                    (input)="field($event, 'storeSlug')"
                    placeholder="canteen"
                    maxlength="48"
                    required
                  />
                </label>
                <label
                  >ชื่อร้าน
                  <input
                    name="storeName"
                    type="text"
                    autocomplete="off"
                    [value]="storeName()"
                    (input)="field($event, 'storeName')"
                    maxlength="160"
                    required
                  />
                </label>
                <button type="submit" [disabled]="pending()">
                  {{ pending() ? "กำลังดำเนินการ..." : "สร้างร้านค้า" }}
                </button>
              </form>
            </div>
          </details>

          <details
            class="owner-panel v6-owner-disclosure"
            aria-labelledby="accept-title"
          >
            <summary>
              <strong id="accept-title">รับคำเชิญเข้าร้าน</strong>
              <span>เข้าร่วมร้านที่เจ้าของร้านเชิญไว้แล้ว</span>
            </summary>
            <div class="v6-owner-form-body">
              <p class="owner-muted">
                ใช้รหัสคำเชิญแบบใช้ครั้งเดียวที่เจ้าของร้านส่งให้
                ไม่ควรนำรหัสนี้ใส่ URL หรือส่งในกลุ่มสาธารณะ
              </p>
              <form (submit)="accept($event)" class="owner-form">
                <label
                  >รหัสคำเชิญ (43 อักขระ)
                  <input
                    type="password"
                    name="invitationToken"
                    autocomplete="off"
                    [value]="invitationToken()"
                    (input)="setInviteToken($event)"
                    maxlength="43"
                    minlength="43"
                    required
                  />
                </label>
                <button type="submit" [disabled]="pending()">
                  {{ pending() ? "กำลังดำเนินการ..." : "ยืนยันรับคำเชิญ" }}
                </button>
              </form>
              <p class="owner-muted">
                หากยังไม่มีบัญชีที่ได้รับอนุมัติ โปรดติดต่อผู้ดูแลก่อน
                การรับคำเชิญไม่ได้สร้างบัญชี Google ใหม่
              </p>
            </div>
          </details>
        </div>
      }
    </div>
  `,
})
export class HomePage implements OnInit {
  readonly unified = inject(ActivatedRoute).snapshot.data["unified"] === true;

  private readonly api = inject(OwnerAdminApi);
  private readonly document = inject(DOCUMENT);
  readonly stores = signal<AdminStore[]>([]);
  readonly authenticated = signal(false);
  readonly loading = signal(true);
  readonly pending = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly tenantSlug = signal("");
  readonly tenantName = signal("");
  readonly storeSlug = signal("");
  readonly storeName = signal("");
  readonly invitationToken = signal("");
  readonly roleLabel = STAFF_ROLE_LABEL;
  readonly ownedCount = computed(
    () => this.stores().filter((store) => store.role === "owner").length,
  );

  ngOnInit(): void {
    void this.loadStores();
  }

  async loadStores(): Promise<void> {
    if (this.pending()) return;
    this.loading.set(true);
    this.error.set("");
    try {
      const response = await this.api.stores();
      this.stores.set(response.stores);
      this.authenticated.set(true);
    } catch (error) {
      this.authenticated.set(false);
      this.stores.set([]);
      this.error.set(failure(error));
    } finally {
      this.loading.set(false);
    }
  }

  field(event: Event, key: keyof MerchantCreation): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const value = event.target.value;
    if (key === "tenantSlug") this.tenantSlug.set(value);
    if (key === "tenantName") this.tenantName.set(value);
    if (key === "storeSlug") this.storeSlug.set(value);
    if (key === "storeName") this.storeName.set(value);
  }

  setInviteToken(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.invitationToken.set(event.target.value);
    }
  }

  async create(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pending() || !this.authenticated()) return;
    const form: MerchantCreation = {
      tenantSlug: this.tenantSlug().trim(),
      tenantName: this.tenantName().trim(),
      storeSlug: this.storeSlug().trim(),
      storeName: this.storeName().trim(),
    };
    const invalid = validMerchantCreation(form);
    if (invalid) {
      this.error.set(invalid);
      return;
    }
    this.pending.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      const result = await this.api.createMerchant(form);
      this.tenantSlug.set("");
      this.tenantName.set("");
      this.storeSlug.set("");
      this.storeName.set("");
      this.notice.set(
        "สร้างร้านสำเร็จ (Store ID: " + result.storeId.slice(0, 8) + "…)",
      );
      const { stores } = await this.api.stores();
      this.stores.set(stores);
    } catch (error) {
      this.error.set(failure(error));
    } finally {
      this.pending.set(false);
    }
  }

  async accept(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pending() || !this.authenticated()) return;
    const token = this.invitationToken().trim();
    if (!validInvitationToken(token)) {
      this.error.set("รหัสคำเชิญไม่ถูกต้อง");
      return;
    }
    this.pending.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await this.api.accept(token);
      this.invitationToken.set("");
      this.notice.set("รับคำเชิญสำเร็จ ตรวจสอบสิทธิ์ร้านค้าจาก Server แล้ว");
      const { stores } = await this.api.stores();
      this.stores.set(stores);
    } catch (error) {
      this.error.set(failure(error));
    } finally {
      this.pending.set(false);
    }
  }

  async logout(): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set("");
    try {
      await this.api.logout();
      this.authenticated.set(false);
      this.stores.set([]);
      this.invitationToken.set("");
      this.notice.set("ออกจากระบบและยกเลิก Session แล้ว");
      this.document.defaultView?.location.assign("/");
    } catch (error) {
      this.error.set(failure(error));
    } finally {
      this.pending.set(false);
    }
  }
}
