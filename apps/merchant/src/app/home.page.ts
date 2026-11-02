import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterLink } from "@angular/router";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: ` <section class="hero" aria-labelledby="hero-title">
      <span class="eyebrow">MERCHANT / PWA</span>
      <h1 id="hero-title">จัดการออร์เดอร์และร้านค้า</h1>
      <p class="lede">ควบคุมงานหน้าร้านจากมือถือ แท็บเล็ต หรือคอมพิวเตอร์</p>
      <div class="notice" role="status">
        <span class="notice-dot"></span>หน้าจัดการร้านเป็นเพียง Foundation
        ยังไม่เปิดรับออร์เดอร์จริง
      </div>
      <a class="primary-link" routerLink="/status"
        >ดูสถานะการพัฒนา <span aria-hidden="true">↗</span></a
      >
    </section>
    <section class="section" aria-labelledby="upcoming-title">
      <div class="section-top">
        <span class="eyebrow">ROADMAP</span>
        <h2 id="upcoming-title">ฟังก์ชันที่จะพัฒนา</h2>
      </div>
      <div class="tiles">
        <article class="tile">
          <span class="tile-id">01</span>
          <h3>รายการออร์เดอร์ใหม่</h3>
          <p>กำลังเตรียมโครงสร้างและข้อกำหนดการใช้งาน</p>
        </article>
        <article class="tile">
          <span class="tile-id">02</span>
          <h3>จัดการเมนูและโต๊ะ</h3>
          <p>เชื่อมต่อกับ Backend และความปลอดภัยในระยะถัดไป</p>
        </article>
      </div>
    </section>`,
})
export class HomePage {}
