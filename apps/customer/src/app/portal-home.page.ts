import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from "@angular/core";
import { DOCUMENT } from "@angular/common";
import {
  HttpClient,
  HttpHeaders,
  HttpErrorResponse,
} from "@angular/common/http";
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { PortalSession } from "./portal-session.service";
import { ROLE_LABEL } from "../../../merchant/src/app/order-board.domain";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: ` <section class="portal-home" aria-labelledby="portal-title">
    @switch (session.phase()) {
      @case ("loading") {
        <h1 id="portal-title">RCAT POS</h1>
        <p role="status">กำลังเปิดพื้นที่ทำงาน...</p>
      }
      @case ("error") {
        <h1 id="portal-title">ยังเชื่อมต่อระบบไม่ได้</h1>
        <p>ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง</p>
        <button class="portal-button" (click)="session.refresh()">
          ลองเชื่อมต่ออีกครั้ง
        </button>
      }
      @case ("guest") {
        <span class="portal-eyebrow">RCAT POS</span>
        <h1 id="portal-title">สั่งอาหารง่าย<br />จัดการร้านในที่เดียว</h1>
        <p class="portal-lead">
          ลูกค้าสแกน QR บนโต๊ะเพื่อเลือกเมนูและส่งออเดอร์ได้ทันที
        </p>
        <div class="portal-panel">
          <h2>สำหรับลูกค้า</h2>
          <p>เริ่มจาก QR ของร้าน หรือกลับไปดูออเดอร์ที่สั่งไว้</p>
          <a routerLink="/order/track">ติดตามออเดอร์ของฉัน →</a>
        </div>
        <div class="portal-panel">
          <h2>สำหรับผู้ดูแลร้านและพนักงาน</h2>
          <p>เข้าสู่ระบบเพื่อเปิดงานที่บัญชีของคุณได้รับสิทธิ์</p>
          @if (session.localLogin()) {
            <form (submit)="login($event)">
              <label for="portal-email">อีเมลบัญชีทดลอง</label
              ><input
                id="portal-email"
                type="email"
                autocomplete="username"
                [value]="email()"
                (input)="email.set(value($event))"
                required
              />
              <label for="portal-password">รหัสผ่านทดลอง</label
              ><input
                id="portal-password"
                type="password"
                autocomplete="current-password"
                [value]="password()"
                (input)="password.set(value($event))"
                required
              />
              <button class="portal-button" [disabled]="busy()">
                {{ busy() ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบทดลอง" }}
              </button>
            </form>
            <small>ใช้บัญชีและรหัสผ่านจาก Terminal สำหรับชุด Local</small>
          } @else {
            <a class="portal-button" href="/api/auth/google/start"
              >เข้าสู่ระบบด้วย Google @rcat.ac.th</a
            >
          }
          @if (error()) {
            <p role="alert">{{ error() }}</p>
          }
        </div>
      }
      @case ("staff") {
        <span class="portal-eyebrow">พื้นที่ทำงานของคุณ</span>
        <h1 id="portal-title">เริ่มงานที่ร้าน</h1>
        <p class="portal-lead">
          เลือกร้านแล้วเปิดออเดอร์หรือจัดการงานตามสิทธิ์ของคุณ
        </p>
        <div class="portal-stores">
          @for (
            store of session.stores();
            track store.tenantId + store.storeId
          ) {
            <article class="portal-panel">
              <span class="portal-role">{{ roles[store.role] }}</span>
              <h2>{{ store.storeName }}</h2>
              <p>{{ store.tenantName }}</p>
              <a
                class="portal-button"
                [routerLink]="['/orders', store.tenantId, store.storeId]"
                >เปิดกระดานออเดอร์</a
              >
              @if (store.role === "owner" || store.role === "manager") {
                <a [routerLink]="['/catalog', store.tenantId, store.storeId]"
                  >เมนูและราคา</a
                ><a [routerLink]="['/tables', store.tenantId, store.storeId]"
                  >โต๊ะและ QR สั่งอาหาร</a
                >
              }
              @if (
                session.localLogin() &&
                store.storeId === "70000000-0000-4000-8000-000000000002" &&
                store.role === "owner"
              ) {
                <button
                  class="portal-button"
                  (click)="demoOrder()"
                  [disabled]="busy()"
                >
                  เปิดโต๊ะทดลองเพื่อสั่งอาหาร</button
                ><small>เริ่มรอบโต๊ะทดลองใหม่และยกเลิกรอบเดิม</small>
              }
              @if (store.role === "owner") {
                <a [routerLink]="['/tenants', store.tenantId, 'staff']"
                  >พนักงานและสิทธิ์</a
                >
              }
            </article>
          } @empty {
            <div class="portal-panel">
              <h2>ยังไม่มีร้านในบัญชีนี้</h2>
              <p>ขอสิทธิ์จากเจ้าของร้าน หรือสร้างร้านของคุณเพื่อเริ่มตั้งค่า</p>
            </div>
          }
        </div>
        @if (canSetUp()) {
          <a class="portal-button portal-secondary" routerLink="/settings"
            >ตั้งค่าร้านและบัญชีบุคลากร</a
          >
        }
      }
    }
  </section>`,
})
export class PortalHomePage {
  readonly session = inject(PortalSession);
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  readonly roles = ROLE_LABEL;
  readonly email = signal("owner@demo.invalid");
  readonly password = signal("");
  readonly busy = signal(false);
  readonly error = signal("");
  canSetUp(): boolean {
    return (
      this.session.stores().length === 0 ||
      this.session.stores().some((store) => store.role === "owner")
    );
  }
  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  async demoOrder(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.session.notice.set("");
    try {
      const token =
        this.document.cookie
          .split("; ")
          .find((value) => value.startsWith("__Host-rcat_csrf="))
          ?.split("=")[1] ?? "";
      const round = await firstValueFrom(
        this.http.post<{ orderingUrl: string }>(
          "/api/tenants/70000000-0000-4000-8000-000000000001/stores/70000000-0000-4000-8000-000000000002/tables/70000000-0000-4000-8000-000000000005/rotate",
          {},
          { headers: new HttpHeaders({ "X-CSRF-Token": token }) },
        ),
      );
      const target = new URL(round.orderingUrl);
      if (
        target.origin !== this.document.location.origin ||
        target.pathname !== "/order"
      )
        throw new Error("Invalid demo URL");
      this.document.location.assign(target.href);
    } catch {
      this.session.notice.set("เปิดโต๊ะทดลองไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      this.busy.set(false);
    }
  }
  async login(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    try {
      await this.session.login(this.email(), this.password());
      this.password.set("");
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse && error.status === 401
          ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
          : "เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    } finally {
      this.busy.set(false);
    }
  }
}
