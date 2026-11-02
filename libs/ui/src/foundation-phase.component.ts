import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { FOUNDATION_STATUS } from "./status-labels";

@Component({
  selector: "rcat-foundation-phase",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="foundation-pill" role="status">{{ label() }}</span>`,
  styles: [
    `
      .foundation-pill {
        display: inline-flex;
        align-items: center;
        min-height: 2rem;
        padding: 0.4rem 0.75rem;
        border-radius: 999px;
        background: #e7f5ed;
        color: #22694a;
        font-size: 0.75rem;
        white-space: nowrap;
      }
    `,
  ],
})
export class FoundationPhaseComponent {
  readonly label = input<string>(FOUNDATION_STATUS.active);
}
