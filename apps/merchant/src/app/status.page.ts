import { ChangeDetectionStrategy, Component, signal } from "@angular/core";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <section class="status-view" aria-labelledby="status-title">
    <span class="eyebrow">SYSTEM READINESS</span>
    <h1 id="status-title">สถานะการพัฒนา</h1>
    <p class="lede">
      ตรวจสอบความพร้อมของส่วนแสดงผล โดยไม่มีข้อมูลธุรกรรมหรือบัญชีร้านจริง
    </p>
    <div class="status-card">
      <div>
        <strong>Frontend</strong>
        <p>Angular Standalone · TypeScript</p>
      </div>
      <span class="phase">{{ phase() }}</span>
    </div>
    <div class="status-card">
      <div>
        <strong>คำสั่งซื้อและ Payment</strong>
        <p>ยังไม่มีบริการรับออร์เดอร์หรือรับชำระเงิน</p>
      </div>
      <span class="phase muted">Not available</span>
    </div>
  </section>`,
})
export class StatusPage {
  readonly phase = signal("G1 — Foundation");
}
