import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterLink } from "@angular/router";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `<section class="hero" aria-labelledby="hero-title">
      <span class="eyebrow">CUSTOMER / QR ORDERING</span>
      <h1 id="hero-title">สั่งอาหารผ่าน QR โต๊ะ</h1>
      <p class="lede">
        สแกน QR สำหรับสั่งอาหารจากร้าน เพื่อเปิดเมนู เลือกตัวเลือก เพิ่มลงตะกร้า
        และติดตามสถานะ โดยไม่ต้องสมัครบัญชี
      </p>
      <div class="notice" role="note">
        <span class="notice-dot"></span>
        QR สำหรับสั่งอาหารไม่ใช่ QR PromptPay และยังไม่เปิดให้ชำระเงินจริง
      </div>
      <a class="primary-link" routerLink="/order">เปิดหน้าสั่งอาหาร</a>
    </section>
    <section class="section" aria-labelledby="guide-title">
      <div class="section-top">
        <span class="eyebrow">HOW IT WORKS</span>
        <h2 id="guide-title">ขั้นตอนสำหรับลูกค้า</h2>
      </div>
      <div class="tiles">
        <article class="tile">
          <span class="tile-id">01 / สแกน QR</span>
          <h3>เลือกโต๊ะ</h3>
          <p>ใช้ QR ที่ร้านออกให้สำหรับรอบการสั่งซื้อปัจจุบัน</p>
        </article>
        <article class="tile">
          <span class="tile-id">02 / ยืนยันออเดอร์</span>
          <h3>เลือกเมนูและตัวเลือก</h3>
          <p>ระบบให้ร้านยืนยันยอดจริงจาก Server ก่อนติดตามสถานะ</p>
        </article>
        <article class="tile">
          <span class="tile-id">03 / ติดตาม</span>
          <h3>ดูความคืบหน้า</h3>
          <p>ตรวจสอบออเดอร์ที่ส่งจากแท็บนี้ได้โดยไม่ต้องเข้าสู่ระบบ</p>
          <a routerLink="/order/track">ดูสถานะออเดอร์</a>
        </article>
      </div>
    </section>`,
})
export class HomePage {}
