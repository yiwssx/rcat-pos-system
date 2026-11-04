import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { OwnerAdminApi } from "./owner-admin.api";
import {
  InvitableRole,
  StaffMember,
  STAFF_ROLE_LABEL,
  normalizeStaffEmail,
  shortStaffId,
  validInviteRole,
  validScopeId,
} from "./owner-admin.domain";

function explain(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
    if (error.status === 403 || error.status === 404) {
      return "ไม่มีสิทธิ์จัดการบุคลากร หรือรายการไม่พร้อมใช้งาน";
    }
    if (error.status === 400)
      return "ข้อมูลไม่ถูกต้อง หรือเกินจำนวนคำเชิญที่อนุญาต";
    if (error.status === 409) return "บัญชีหรือคำเชิญนี้มีอยู่แล้ว";
    if (error.status === 0) return "เครือข่ายขัดข้อง กรุณาลองใหม่";
  }
  return error instanceof Error ? error.message : "ไม่สามารถดำเนินการได้";
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrls: ["./owner-admin.css"],
  template: `
    <section class="owner-shell" aria-labelledby="staff-heading">
      <a routerLink="/" class="owner-back">← กลับหน้าบริหารร้าน</a>
      <span class="eyebrow">ROLE BASED ACCESS CONTROL</span>
      <h1 id="staff-heading">จัดการสิทธิ์บุคลากร</h1>
      <p class="owner-muted">
        Tenant: {{ tenantId }} · เฉพาะเจ้าของร้านที่ได้รับสิทธิ์
      </p>
      <p class="owner-alert" role="note">
        การเชิญหรือเปลี่ยนสิทธิ์มีผลต่อการเข้าถึงออเดอร์และข้อมูลร้านค้า
        ทุกคำสั่งต้องผ่าน Session/CSRF และ RBAC ใน PostgreSQL
      </p>
      @if (loading()) {
        <p role="status" class="owner-state">กำลังตรวจสอบสิทธิ์และบุคลากร...</p>
      }
      @if (error()) {
        <div class="owner-error" role="alert">
          {{ error() }}
          <button type="button" (click)="reload()" [disabled]="pending()">
            ลองใหม่
          </button>
        </div>
      }
      @if (notice()) {
        <p class="owner-success" role="status">{{ notice() }}</p>
      }
      @if (ready()) {
        <div class="owner-grid">
          <section class="owner-panel" aria-labelledby="invite-heading">
            <h2 id="invite-heading">เชิญพนักงาน</h2>
            <p class="owner-muted">
              เชิญเฉพาะผู้มีบัญชี @rcat.ac.th ที่ได้รับอนุมัติแล้ว ระบบออก Token
              ใช้ครั้งเดียว อายุ 72 ชั่วโมง
            </p>
            <form class="owner-form" (submit)="invite($event)">
              <label
                >อีเมลบุคลากร
                <input
                  type="email"
                  name="email"
                  autocomplete="email"
                  inputmode="email"
                  placeholder="staff@rcat.ac.th"
                  [value]="email()"
                  (input)="onEmail($event)"
                  required
                />
              </label>
              <label
                >บทบาท
                <select [value]="inviteRole()" (change)="onInviteRole($event)">
                  <option value="manager">ผู้จัดการ</option>
                  <option value="cashier">แคชเชียร์</option>
                  <option value="kitchen">พนักงานครัว</option>
                </select>
              </label>
              <button type="submit" [disabled]="pending()">
                {{ pending() ? "กำลังตรวจสอบ..." : "ออกคำเชิญ" }}
              </button>
            </form>
            @if (issuedToken()) {
              <div
                class="owner-secret"
                aria-labelledby="invitation-secret-heading"
              >
                <h3 id="invitation-secret-heading">รหัสคำเชิญครั้งเดียว</h3>
                <p class="owner-muted">
                  คัดลอกเพื่อส่งทางช่องทางส่วนตัวที่ปลอดภัย
                  ระบบยังไม่ได้ส่งคำเชิญทางอีเมลอัตโนมัติ
                  เมื่อออกจากหน้านี้จะไม่แสดงรหัสซ้ำ
                </p>
                <code>{{ issuedToken() }}</code>
                <button
                  type="button"
                  [disabled]="pending()"
                  (click)="copyToken()"
                >
                  คัดลอกรหัสคำเชิญ
                </button>
                <button
                  type="button"
                  class="owner-subtle"
                  (click)="dismissToken()"
                >
                  ซ่อนรหัสคำเชิญ
                </button>
              </div>
            }
          </section>

          <section class="owner-panel" aria-labelledby="members-heading">
            <div class="owner-headline">
              <h2 id="members-heading">บุคลากรที่มีสิทธิ์</h2>
              <button
                type="button"
                (click)="reload()"
                [disabled]="pending() || loading()"
              >
                โหลดข้อมูลใหม่
              </button>
            </div>
            @if (staff().length === 0) {
              <p class="owner-muted">ยังไม่พบข้อมูลบุคลากร</p>
            } @else {
              <ul class="owner-staff-list">
                @for (member of staff(); track member.user_id) {
                  <li>
                    <div class="owner-staff-meta">
                      <strong>{{ shortId(member.user_id) }}</strong>
                      <span>{{ roleLabel[member.role] }}</span>
                    </div>
                    @if (member.role !== "owner") {
                      <div class="owner-staff-controls">
                        <label [attr.for]="'role-' + member.user_id"
                          >เปลี่ยนบทบาท</label
                        >
                        <select
                          [id]="'role-' + member.user_id"
                          [disabled]="pending()"
                          [value]="roleFor(member)"
                          (change)="selectRole($event, member.user_id)"
                        >
                          <option value="manager">ผู้จัดการ</option>
                          <option value="cashier">แคชเชียร์</option>
                          <option value="kitchen">พนักงานครัว</option>
                        </select>
                        <button
                          type="button"
                          [disabled]="
                            pending() || roleFor(member) === member.role
                          "
                          (click)="changeRole(member)"
                        >
                          บันทึกสิทธิ์
                        </button>
                        <button
                          type="button"
                          class="owner-danger"
                          [disabled]="pending()"
                          (click)="remove(member)"
                        >
                          นำออกจากร้าน
                        </button>
                      </div>
                    } @else {
                      <p class="owner-muted">
                        ไม่สามารถเปลี่ยนหรือลบเจ้าของร้านผ่านหน้านี้
                      </p>
                    }
                  </li>
                }
              </ul>
            }
            <p class="owner-muted">
              รายการแสดงรหัส User ID แบบย่อ เนื่องจาก API
              ไม่เปิดเผยอีเมลผู้ใช้งานอื่น
              โปรดตรวจสอบรายชื่อจริงจากระบบสิทธิ์ที่ได้รับอนุมัติ
            </p>
          </section>
        </div>
      }
    </section>
  `,
})
export class StaffPage implements OnInit, OnDestroy {
  private readonly api = inject(OwnerAdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  readonly tenantId = this.route.snapshot.paramMap.get("tenantId") ?? "";
  readonly loading = signal(true);
  readonly pending = signal(false);
  readonly ready = signal(false);
  readonly staff = signal<StaffMember[]>([]);
  readonly error = signal("");
  readonly notice = signal("");
  readonly email = signal("");
  readonly inviteRole = signal<InvitableRole>("cashier");
  readonly issuedToken = signal("");
  readonly chosenRoles = signal<Record<string, InvitableRole>>({});
  readonly roleLabel = STAFF_ROLE_LABEL;
  readonly shortId = shortStaffId;

  ngOnInit(): void {
    void this.reload();
  }

  ngOnDestroy(): void {
    this.issuedToken.set("");
  }

  onEmail(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.email.set(event.target.value);
  }
  onInviteRole(event: Event): void {
    if (
      event.target instanceof HTMLSelectElement &&
      validInviteRole(event.target.value)
    ) {
      this.inviteRole.set(event.target.value);
    }
  }
  selectRole(event: Event, userId: string): void {
    if (event.target instanceof HTMLSelectElement) {
      const role = event.target.value;
      if (validInviteRole(role)) {
        this.chosenRoles.update((roles) => ({ ...roles, [userId]: role }));
      }
    }
  }
  roleFor(member: StaffMember): InvitableRole {
    return (
      this.chosenRoles()[member.user_id] ??
      (member.role === "owner" ? "manager" : member.role)
    );
  }

  async reload(): Promise<void> {
    if (this.pending()) return;
    this.loading.set(true);
    this.error.set("");
    this.ready.set(false);
    try {
      if (!validScopeId(this.tenantId)) throw new Error("Tenant ID ไม่ถูกต้อง");
      const { stores } = await this.api.stores();
      if (
        !stores.some(
          (store) => store.tenantId === this.tenantId && store.role === "owner",
        )
      ) {
        throw new Error("บัญชีนี้ไม่ได้รับสิทธิ์เจ้าของร้านของ Tenant นี้");
      }
      const result = await this.api.staff(this.tenantId);
      this.staff.set(result.staff);
      this.chosenRoles.set({});
      this.ready.set(true);
    } catch (error) {
      this.staff.set([]);
      this.error.set(explain(error));
    } finally {
      this.loading.set(false);
    }
  }

  async invite(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pending() || !this.ready()) return;
    const email = normalizeStaffEmail(this.email());
    if (!email) {
      this.error.set("อนุญาตเฉพาะอีเมลบุคลากร @rcat.ac.th ที่ถูกต้อง");
      return;
    }
    this.pending.set(true);
    this.error.set("");
    this.notice.set("");
    this.issuedToken.set("");
    try {
      const result = await this.api.invite(
        this.tenantId,
        email,
        this.inviteRole(),
      );
      if (!result.invitationToken) throw new Error("Backend ไม่คืนรหัสคำเชิญ");
      this.issuedToken.set(result.invitationToken);
      this.email.set("");
      this.notice.set("ออกคำเชิญสำเร็จ โปรดส่งรหัสแบบส่วนตัว");
    } catch (error) {
      this.error.set(explain(error));
    } finally {
      this.pending.set(false);
    }
  }

  async copyToken(): Promise<void> {
    const token = this.issuedToken();
    if (!token) return;
    try {
      const clipboard = this.document.defaultView?.navigator.clipboard;
      if (!clipboard) throw new Error("Clipboard unavailable");
      await clipboard.writeText(token);
      this.notice.set("คัดลอกแล้ว รหัสนี้เป็นความลับ");
    } catch {
      this.error.set("คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกด้วยตนเอง");
    }
  }

  dismissToken(): void {
    this.issuedToken.set("");
  }

  async changeRole(member: StaffMember): Promise<void> {
    if (this.pending() || member.role === "owner") return;
    const role = this.roleFor(member);
    if (role === member.role || !validInviteRole(role)) return;
    const ok = this.document.defaultView?.confirm(
      "ยืนยันเปลี่ยนสิทธิ์ของ " +
        shortStaffId(member.user_id) +
        " จาก " +
        STAFF_ROLE_LABEL[member.role] +
        " เป็น " +
        STAFF_ROLE_LABEL[role] +
        " ?",
    );
    if (!ok) return;
    this.pending.set(true);
    this.error.set("");
    try {
      await this.api.changeRole(this.tenantId, member.user_id, role);
      const latest = await this.api.staff(this.tenantId);
      this.staff.set(latest.staff);
      this.chosenRoles.set({});
      this.notice.set("เปลี่ยนสิทธิ์สำเร็จตามข้อมูลจาก Backend");
    } catch (error) {
      this.error.set(explain(error));
    } finally {
      this.pending.set(false);
    }
  }

  async remove(member: StaffMember): Promise<void> {
    if (this.pending() || member.role === "owner") return;
    const ok = this.document.defaultView?.confirm(
      "ยืนยันนำพนักงาน " +
        shortStaffId(member.user_id) +
        " ออกจากร้าน? การเข้าถึงออเดอร์ของ Tenant นี้จะถูกยกเลิก",
    );
    if (!ok) return;
    this.pending.set(true);
    this.error.set("");
    try {
      await this.api.removeStaff(this.tenantId, member.user_id);
      const latest = await this.api.staff(this.tenantId);
      this.staff.set(latest.staff);
      this.chosenRoles.set({});
      this.notice.set("นำพนักงานออกจากร้านสำเร็จตามข้อมูล Backend");
    } catch (error) {
      this.error.set(explain(error));
    } finally {
      this.pending.set(false);
    }
  }
}
