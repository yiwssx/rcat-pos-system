import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmLabel } from "@spartan-ng/helm/label";
import {
  formatSatang,
  type GuestModifierGroup,
  type GuestModifierOption,
} from "./guest-order.domain";

/**
 * Presentation-only component. Choice validation and cart totals remain
 * owned by guest-order.domain and checked again by the Order API.
 * No per-component CSS: official Spartan Helm + semantic Tailwind utilities.
 */
@Component({
  selector: "rcat-guest-modifier-choices",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmBadge, HlmLabel],
  host: { class: "block min-w-0" },
  template: `
    <fieldset class="grid min-w-0 gap-2 border-t border-border py-4">
      <legend class="w-full pb-2 text-base font-semibold text-foreground">
        {{ group().name }}
        <span hlmBadge variant="secondary" class="ms-2">
          {{ hint() }}
        </span>
      </legend>
      @if (choices().length < group().minSelect) {
        <p class="text-sm leading-6 text-destructive" role="alert">
          ตัวเลือกไม่เพียงพอ กรุณาแจ้งร้านค้า
        </p>
      }
      @if (group().maxSelect === 1 && group().minSelect === 0) {
        <label
          hlmLabel
          class="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-foreground has-[:checked]:border-primary/40 has-[:checked]:bg-accent"
        >
          <input
            class="size-5 shrink-0 accent-primary"
            type="radio"
            [name]="'modifier-' + group().id"
            [checked]="selectedCount() === 0"
            [disabled]="busy()"
            (change)="clear.emit()"
          />
          <span class="min-w-0 flex-1 text-sm">ไม่เพิ่มตัวเลือก</span>
          <span
            class="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
          >
            +0.00 ฿
          </span>
        </label>
      }
      @for (choice of choices(); track choice.id) {
        <label
          hlmLabel
          class="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-foreground has-[:checked]:border-primary/40 has-[:checked]:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
        >
          <input
            class="size-5 shrink-0 accent-primary"
            [type]="group().maxSelect === 1 ? 'radio' : 'checkbox'"
            [name]="'modifier-' + group().id"
            [checked]="isSelected(choice.id)"
            [disabled]="busy() || selectionDisabled(choice.id)"
            (change)="optionToggle.emit(choice.id)"
          />
          <span class="min-w-0 flex-1 text-sm leading-6">{{
            choice.name
          }}</span>
          <span
            class="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
          >
            {{ priceLabel(choice.priceDeltaSatang) }}
          </span>
        </label>
      }
    </fieldset>
  `,
})
export class GuestModifierChoicesComponent {
  readonly group = input.required<GuestModifierGroup>();
  readonly choices = input.required<readonly GuestModifierOption[]>();
  readonly selectedIds = input.required<readonly string[]>();
  readonly busy = input(false);
  readonly optionToggle = output<string>();
  readonly clear = output<void>();

  readonly selectedCount = computed(() => {
    const selected = new Set(this.selectedIds());
    return this.choices().filter((option) => selected.has(option.id)).length;
  });

  readonly hint = computed(() => {
    const { minSelect, maxSelect } = this.group();
    if (maxSelect === 1) {
      return minSelect === 1 ? "จำเป็น · เลือก 1" : "ไม่จำเป็น · เลือกได้ 1";
    }
    return `เลือก ${minSelect}–${maxSelect} · ${minSelect ? "จำเป็น" : "ไม่บังคับ"}`;
  });

  isSelected(optionId: string): boolean {
    return this.selectedIds().includes(optionId);
  }

  selectionDisabled(optionId: string): boolean {
    // Radios must always be switchable; checkboxes only stop at maxSelect.
    return (
      this.group().maxSelect > 1 &&
      !this.isSelected(optionId) &&
      this.selectedCount() >= this.group().maxSelect
    );
  }

  priceLabel(satang: number): string {
    const sign = satang > 0 ? "+" : satang < 0 ? "−" : "+";
    return sign + formatSatang(Math.abs(satang)) + " ฿";
  }
}
