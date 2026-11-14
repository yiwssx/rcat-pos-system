import { Directive, input } from "@angular/core";
import { BrnButton } from "@spartan-ng/brain/button";

/**
 * Accessible Spartan/Brain behavior with RCAT-owned Helm presentation.
 * A small bounded starting point: replace high-visibility buttons first.
 */
@Directive({
  selector: "button[rcatBtn], a[rcatBtn]",
  standalone: true,
  hostDirectives: [{ directive: BrnButton, inputs: ["disabled"] }],
  host: {
    class: "rcat-btn",
    "[attr.data-variant]": "variant()",
  },
})
export class RcatButtonDirective {
  readonly variant = input<"primary" | "secondary" | "outline">("primary");
}
