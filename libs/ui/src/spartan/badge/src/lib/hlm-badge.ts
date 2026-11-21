import { Directive, input } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";
import { type VariantProps, cva } from "class-variance-authority";

const badgeVariants = cva(
  "min-h-6 gap-1 rounded-md border border-transparent px-2 py-0.5 text-xs font-medium transition-none has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>ng-icon]:text-[length:--spacing(3)]! group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex w-fit max-w-full min-w-0 items-center justify-center whitespace-normal break-words focus-visible:ring-[3px] [&>ng-icon]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-accent",
        destructive:
          "bg-danger-soft text-foreground [a]:hover:bg-danger-soft focus-visible:ring-destructive/30",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-foreground underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeVariants = VariantProps<typeof badgeVariants>;

@Directive({
  selector: "[hlmBadge],hlm-badge",
  exportAs: "hlmBadge",
  host: {
    "data-slot": "badge",
    "[attr.data-variant]": "variant()",
  },
})
export class HlmBadge {
  public readonly variant = input<BadgeVariants["variant"]>("default");

  constructor() {
    classes(() => badgeVariants({ variant: this.variant() }));
  }
}
