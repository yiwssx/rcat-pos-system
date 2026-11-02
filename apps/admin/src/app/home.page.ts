import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="hero" aria-labelledby="hero-title">
      <span class="eyebrow">PLATFORM / ADMIN</span>
      <h1 id="hero-title">บริหาร RCAT POS Platform</h1>
      <p class="lede">จัดการร้านค้าและสิทธิ์ใช้งานในระบบ SaaS</p>
      <div class="notice" role="status"><span class="notice-dot"></span>Admin Portal อยู่ระหว่างพัฒนา ยังไม่มีการเข้าสู่ระบบหรือข้อมูลร้านค้าจริง</div>
      <a class="primary-link" routerLink="/status">ดูสถานะการพัฒนา <span aria-hidden="true">↗</span></a>
    </section>
    <section class="section" aria-labelledby="upcoming-title">
      <div class="section-top"><span class="eyebrow">ROADMAP</span><h2 id="upcoming-title">ฟังก์ชันที่จะพัฒนา</h2></div>
      <div class="tiles">
        <article class="tile"><span class="tile-id">01</span><h3>การจัดการผู้เช่า</h3><p>กำลังเตรียมโครงสร้างและข้อกำหนดการใช้งาน</p></article>
        <article class="tile"><span class="tile-id">02</span><h3>ระบบและการกำกับดูแล</h3><p>เชื่อมต่อกับ Backend และความปลอดภัยในระยะถัดไป</p></article>
      </div>
    </section>`,
})
export class HomePage {}
