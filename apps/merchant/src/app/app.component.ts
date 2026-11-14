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
        ><img
          class="brand-mark"
          src="/rcat-pos-logo.webp"
          width="38"
          height="38"
          alt=""
        />
        RCAT <span class="brand-light">POS</span></a
      >
      <nav aria-label="นำทาง">
        <a routerLink="/">ภาพรวม</a>
        <a routerLink="/status">สถานะระบบ</a>
      </nav>
    </header>
    <main id="main"><router-outlet /></main>
    <footer class="footer">
      RCAT POS · G3 Merchant Operations · ยังไม่เปิดรับชำระเงินหรือใช้งาน
      Production
    </footer>
  </div>`,
})
export class AppComponent {}
