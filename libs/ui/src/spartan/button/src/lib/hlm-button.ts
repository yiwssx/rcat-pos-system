import { Directive, input, signal } from "@angular/core";
import { BrnButton } from "@spartan-ng/brain/button";
import { classes } from "@spartan-ng/helm/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ClassValue } from "clsx";
import { injectBrnButtonConfig } from "./hlm-button.token";

export const buttonVariants = cva(
  "focus-visible:border-ring focus-visible:ring-ring/30 data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-xl border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex min-w-11 max-w-full items-center justify-center whitespace-normal break-words text-center transition-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring select-none data-disabled:pointer-events-none data-disabled:bg-disabled data-disabled:text-disabled-foreground data-disabled:border-input data-disabled:opacity-100 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-action bg-action text-action-foreground hover:bg-action-hover",
        outline:
          "border-input bg-card hover:bg-muted hover:text-foreground dark:hover:bg-input/30 aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent",
        secondary:
          "border-secondary-line bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "border-destructive bg-danger-soft text-foreground hover:bg-danger-hover focus-visible:ring-destructive/30",
        link: "text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default:
          "min-h-11 gap-1.5 px-3 py-2 has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5",
        xs: "min-h-11 gap-1 px-2.5 py-2 text-xs has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(3)]",
        sm: "min-h-11 gap-1 px-3 py-2 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        lg: "min-h-12 gap-1.5 px-4 py-2 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
        icon: "size-11",
        "icon-xs":
          "size-11 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(3)]",
        "icon-sm": "size-11",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

@Directive({
  selector: "button[hlmBtn], a[hlmBtn]",
  exportAs: "hlmBtn",
  hostDirectives: [{ directive: BrnButton, inputs: ["disabled"] }],
  host: { "data-slot": "button" },
})
export class HlmButton {
  private readonly _config = injectBrnButtonConfig();

  private readonly _additionalClasses = signal<ClassValue>("");

  public readonly variant = input<ButtonVariants["variant"]>(
    this._config.variant,
  );

  public readonly size = input<ButtonVariants["size"]>(this._config.size);

  constructor() {
    classes(() => [
      buttonVariants({ variant: this.variant(), size: this.size() }),
      this._additionalClasses(),
    ]);
  }

  setClass(classes: string): void {
    this._additionalClasses.set(classes);
  }
}
