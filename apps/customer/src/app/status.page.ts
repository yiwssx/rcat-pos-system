import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { FoundationPhaseComponent } from "@rcat/ui";

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FoundationPhaseComponent],
  template: ` <section
    class="mx-auto grid w-full max-w-3xl min-w-0 gap-4 p-4 sm:p-8"
    aria-labelledby="status-title"
  >
    <span class="text-sm font-semibold text-foreground">SYSTEM READINESS</span>
    <h1 id="status-title" class="text-2xl font-semibold sm:text-3xl">
      สถานะการพัฒนา
    </h1>
    <p class="text-base leading-7 text-muted-foreground">
      ตรวจสอบความพร้อมของส่วนแสดงผล โดยไม่มีข้อมูลธุรกรรมหรือบัญชีร้านจริง
    </p>
    <div
      class="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div>
        <strong>Frontend</strong>
        <p>Angular Standalone · TypeScript</p>
      </div>
      <rcat-foundation-phase [label]="phase()" />
    </div>
    <div
      class="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div>
        <strong>คำสั่งซื้อและ Payment</strong>
        <p>
          รับออเดอร์และติดตามสถานะได้ผ่าน QR โต๊ะที่ยังใช้ได้ แต่ยังไม่มี
          Payment จริง
        </p>
      </div>
      <span class="rounded-md bg-muted px-3 py-2 text-sm text-foreground"
        >Not available</span
      >
    </div>
  </section>`,
})
export class StatusPage {
  readonly phase = signal("G2 — Guest Ordering");
}
