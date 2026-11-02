import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'rcat-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet],
  template: `
    <div class="layout">
      <header class="topbar">
        <a class="brand" routerLink="/" aria-label="RCAT POS หน้าแรก"><span class="brand-mark">R</span> RCAT <span class="brand-light">POS</span></a>
        <nav aria-label="นำทาง">
          <a routerLink="/">ภาพรวม</a>
          <a routerLink="/status">สถานะระบบ</a>
        </nav>
      </header>
      <main id="main"><router-outlet /></main>
      <footer class="footer">RCAT POS · G1 Foundation · ไม่เปิดรับธุรกรรมจริง</footer>
    </div>`,
})
export class AppComponent {}
