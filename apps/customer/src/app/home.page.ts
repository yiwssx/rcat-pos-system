import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="hero" aria-labelledby="hero-title">
      <span class="eyebrow">CUSTOMER / WEB</span>
      <h1 id="hero-title">สั่งอาหารผ่าน QR</h1>
      <p class="lede">เลือกเมนูจากโทรศัพท์ได้ทันที เมื่อร้านเปิดให้บริการ</p>
      <div class="notice" role="status"><span class="notice-dot"></span>ระบบหน้าลูกค้าอยู่ระหว่างการพัฒนา ยังไม่สามารถส่งคำสั่งซื้อหรือชำระเงินได้</div>
      <a class="primary-link" routerLink="/status">ดูสถานะการพัฒนา <span aria-hidden="true">↗</span></a>
    </section>
    <section class="section" aria-labelledby="upcoming-title">
      <div class="section-top"><span class="eyebrow">ROADMAP</span><h2 id="upcoming-title">ฟังก์ชันที่จะพัฒนา</h2></div>
      <div class="tiles">
        <article class="tile"><span class="tile-id">01</span><h3>เมนูและตะกร้าสินค้า</h3><p>กำลังเตรียมโครงสร้างและข้อกำหนดการใช้งาน</p></article>
        <article class="tile"><span class="tile-id">02</span><h3>ติดตามสถานะออร์เดอร์</h3><p>เชื่อมต่อกับ Backend และความปลอดภัยในระยะถัดไป</p></article>
      </div>
    </section>`,
})
export class HomePage {}
