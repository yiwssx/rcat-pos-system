import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { HttpErrorResponse } from "@angular/common/http";
import { MerchantStore, ROLE_LABEL } from "./order-board.domain";
import { MerchantOrderApi } from "./merchant-order.api";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `<section class="hero merchant-home" aria-labelledby="hero-title">
    <span class="eyebrow">MERCHANT / OPERATIONS</span>
    <h1 id="hero-title">จัดการออเดอร์หน้าร้าน</h1>
    <p class="lede">
      ตรวจสอบออเดอร์ใหม่ รับรายการ เตรียมอาหาร และติดตามเหตุการณ์ย้อนหลัง
      ได้จากมือถือ แท็บเล็ต หรือคอมพิวเตอร์
    </p>
    <p class="notice">
      <span class="notice-dot"></span>
      ระบบอยู่ระหว่างพัฒนา · ยังไม่มีการรับชำระเงิน PromptPay
      และยังไม่เปิดใช้งาน Production
    </p>
    <div class="google-access">
      <a class="google-login" href="/api/auth/google/start">
        เข้าสู่ระบบด้วย Google Workspace (@rcat.ac.th)
      </a>
      <p>
        ใช้บัญชีบุคลากรที่ได้รับสิทธิ์จากเจ้าของร้านแล้วเท่านั้น การใช้บัญชี
        Google อื่นหรือบัญชีที่ไม่อยู่ในวิทยาลัยจะไม่ได้รับสิทธิ์
      </p>
    </div>
    <div class="section-top">
      <span class="eyebrow">YOUR STORES</span>
      <h2 id="stores-title">ร้านค้าที่บัญชีนี้เข้าถึงได้</h2>
    </div>
    @if (loading()) {
      <p role="status">กำลังตรวจสอบสิทธิ์ร้านค้า...</p>
    } @else if (error()) {
      <div class="store-message" role="alert">
        {{ error() }}
        <button type="button" (click)="loadStores()">ลองอีกครั้ง</button>
      </div>
    } @else if (stores().length === 0) {
      <p class="store-message" role="status">
        ยังไม่มีร้านค้าที่บัญชีนี้ได้รับสิทธิ์
        โปรดติดต่อเจ้าของร้านหรือผู้ดูแลระบบ
      </p>
    } @else {
      <div class="store-grid">
        @for (store of stores(); track store.tenantId + store.storeId) {
          <article class="store-card">
            <span class="store-role">{{ roleLabel[store.role] }}</span>
            <h3>{{ store.storeName }}</h3>
            <p>{{ store.tenantName }}</p>
            <a
              class="primary-link"
              [routerLink]="['/orders', store.tenantId, store.storeId]"
              >เปิดกระดานออเดอร์</a
            >
            @if (store.role !== "cashier") {
              <a
                class="store-report-link"
                [routerLink]="['/inventory', store.tenantId, store.storeId]"
                >จัดการสต็อกและสูตรวัตถุดิบ</a
              >
            }
            @if (store.role === "owner" || store.role === "manager") {
              <a
                class="store-report-link"
                [routerLink]="['/catalog', store.tenantId, store.storeId]"
                >จัดการเมนูและราคาสินค้า</a
              >
              <a
                class="store-report-link"
                [routerLink]="['/tables', store.tenantId, store.storeId]"
                >พิมพ์ QR โต๊ะและออกรหัสรอบโต๊ะ</a
              >
              <a
                class="store-report-link"
                [routerLink]="['/reports', store.tenantId, store.storeId]"
                >ดูรายงานออเดอร์ (ไม่ใช่รายรับ)</a
              >
            }
          </article>
        }
      </div>
    }
    <p class="home-help">
      ระบบออก Session และตรวจสิทธิ์จาก Backend หลังยืนยัน Google Workspace
      ต้องกำหนด OAuth Client และ HTTPS Redirect URI ก่อนใช้งานจริง
      โครงการยังไม่เปิด Production
    </p>
  </section>`,
  styles: [
    `
      .merchant-home {
        padding-top: clamp(2.5rem, 7vw, 5.5rem);
      }
      .merchant-home h1 {
        max-width: 20ch;
      }
      .store-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 285px), 1fr));
        gap: 1rem;
      }
      .store-card {
        border: 1px solid #e0e7f0;
        border-radius: 1rem;
        padding: 1.5rem;
        background: #fff;
      }
      .store-card h3 {
        margin: 0.8rem 0 0.3rem;
        font-size: 1.25rem;
      }
      .store-card p {
        color: #55647d;
        margin-bottom: 1.4rem;
      }
      .store-role {
        color: #245d71;
        background: #e5f3f7;
        border-radius: 0.5rem;
        padding: 0.3rem 0.6rem;
        font-size: 0.78rem;
        font-weight: 700;
      }
      .store-message {
        padding: 1.5rem;
        border: 1px solid #d6e0ea;
        background: #fff;
        border-radius: 0.85rem;
        line-height: 1.7;
      }
      .store-message button {
        min-height: 44px;
        margin-left: 0.75rem;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        cursor: pointer;
      }
      .store-report-link {
        display: inline-flex;
        margin-top: 0.9rem;
        align-items: center;
        min-height: 44px;
        color: #235570;
        font-size: 0.86rem;
        font-weight: 750;
        text-decoration: underline;
      }
      .google-access {
        margin: 1.3rem 0 1.8rem;
        display: grid;
        justify-items: start;
        gap: 0.6rem;
      }
      .google-login {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        min-height: 48px;
        background: #fff;
        border: 1px solid #8eaac0;
        border-radius: 0.7rem;
        padding: 0.6rem 1.1rem;
        color: #173956;
        font-weight: 800;
        text-decoration: none;
      }
      .google-login:focus-visible {
        outline: 3px solid #d88d2a;
        outline-offset: 3px;
      }
      .google-access p {
        margin: 0;
        color: #5f6f83;
        font-size: 0.86rem;
        line-height: 1.7;
      }
      .home-help {
        color: #62718b;
        line-height: 1.7;
        font-size: 0.86rem;
        margin-top: 1.5rem;
      }
    `,
  ],
})
export class HomePage implements OnInit {
  private readonly api = inject(MerchantOrderApi);
  readonly stores = signal<MerchantStore[]>([]);
  readonly error = signal("");
  readonly loading = signal(true);
  readonly roleLabel = ROLE_LABEL;

  ngOnInit(): void {
    void this.loadStores();
  }

  async loadStores(): Promise<void> {
    this.error.set("");
    this.loading.set(true);
    try {
      const { stores } = await this.api.stores();
      this.stores.set(stores);
    } catch (error) {
      this.stores.set([]);
      this.error.set(
        error instanceof HttpErrorResponse && error.status === 401
          ? "กรุณาเข้าสู่ระบบด้วยบัญชีพนักงานก่อนเข้าใช้งาน"
          : "ไม่สามารถตรวจสอบสิทธิ์ร้านค้าได้ โปรดลองใหม่",
      );
    } finally {
      this.loading.set(false);
    }
  }
}
