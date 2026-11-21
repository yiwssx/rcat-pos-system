import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { FOUNDATION_STATUS } from "./status-labels";

@Component({
  selector: "rcat-foundation-phase",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="inline-flex min-h-8 max-w-full items-center rounded-md bg-served px-3 py-2 text-sm text-foreground"
    role="status"
    >{{ label() }}</span
  >`,
})
export class FoundationPhaseComponent {
  readonly label = input<string>(FOUNDATION_STATUS.active);
}
