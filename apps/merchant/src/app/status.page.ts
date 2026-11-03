import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { FoundationPhaseComponent } from "@rcat/ui";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FoundationPhaseComponent],
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
      <rcat-foundation-phase [label]="phase()" />
    </div>
    <div class="status-card">
      <div>
        <strong>คำสั่งซื้อและ Payment</strong>
        <p>Backend รับออเดอร์และแสดงกระดานพนักงานได้แล้ว แต่ยังไม่มีระบบชำระเงินจริง</p>
      </div>
      <span class="phase muted">Not available</span>
    </div>
  </section>`,
})
export class StatusPage {
  readonly phase = signal("G3 — Merchant Order Board");
}
