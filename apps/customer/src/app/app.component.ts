import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterLink, RouterOutlet } from "@angular/router";

@Component({
  selector: "rcat-root",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet],
  template: ` <div class="layout">
    <header class="topbar">
      <a class="brand" routerLink="/" aria-label="RCAT POS หน้าแรก"
        ><span class="brand-mark">R</span> RCAT
        <span class="brand-light">POS</span></a
      >
      <nav aria-label="นำทาง">
        <a routerLink="/">ภาพรวม</a>
        <a routerLink="/order">สั่งอาหาร</a>
        <a routerLink="/order/track">ติดตามออเดอร์</a>
      </nav>
    </header>
    <main id="main"><router-outlet /></main>
    <footer class="footer">
      RCAT POS · Guest Ordering · ยังไม่มีการชำระเงินผ่านระบบ
    </footer>
  </div>`,
})
export class AppComponent {}
