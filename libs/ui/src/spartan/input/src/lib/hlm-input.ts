import { Directive } from "@angular/core";
import { BrnFieldControlDescribedBy } from "@spartan-ng/brain/field";
import { BrnInput } from "@spartan-ng/brain/input";
import { classes } from "@spartan-ng/helm/utils";

@Directive({
  selector: "[hlmInput]",
  exportAs: "hlmInput",
  hostDirectives: [
    { directive: BrnInput, inputs: ["id", "forceInvalid"] },
    BrnFieldControlDescribedBy,
  ],
  host: { "data-slot": "input" },
})
export class HlmInput {
  constructor() {
    classes(
      () =>
        "bg-card focus-visible:border-ring focus-visible:ring-ring/30 data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 min-h-11 rounded-xl border border-input px-3 py-1 text-base transition-[color,box-shadow,background-color] file:h-7 file:text-sm file:font-medium focus-visible:ring-3 data-[matches-spartan-invalid=true]:ring-3 md:text-sm file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground disabled:opacity-100",
    );
  }
}
