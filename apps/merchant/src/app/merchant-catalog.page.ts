import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmLabel } from "@spartan-ng/helm/label";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmCard } from "@spartan-ng/helm/card";
import { HlmNativeSelect } from "@spartan-ng/helm/native-select";
import { prepareProductWebp } from "./prepare-product-webp";
import { MerchantOrderApi } from "./merchant-order.api";
import { CATALOG_PAGE_SIZE, parseDeltaBaht } from "./catalog-list";
import {
  CatalogCategory,
  CatalogCursor,
  CatalogProduct,
  CatalogModifierGroup,
  CatalogModifierOption,
  MerchantCatalogApi,
} from "./merchant-catalog.api";

function parseBaht(value: string): number | null {
  const input = value.trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  const satang = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return satang >= 1 && satang <= 100000000 ? satang : null;
}

function bahtInput(satang: number): string {
  return (
    Math.floor(satang / 100) + "." + (satang % 100).toString().padStart(2, "0")
  );
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmBadge,
    HlmCard,
    HlmNativeSelect,
  ],
  template: `
    <section
      class="mx-auto box-border w-full max-w-7xl space-y-5 px-4 pb-16 pt-6 sm:px-6 lg:px-8"
      aria-labelledby="catalog-title"
    >
      <header
        class="space-y-3 rounded-2xl bg-action p-4 text-action-foreground sm:p-6"
      >
        <a hlmBtn routerLink="/" variant="outline">← ร้านค้าของฉัน</a>
        <p
          class="text-xs font-semibold uppercase tracking-widest text-action-foreground"
        >
          MERCHANT / MENU MANAGEMENT
        </p>
        <h1 id="catalog-title" class="text-3xl font-semibold">
          จัดการเมนูและสินค้า
        </h1>
        <p class="text-base leading-relaxed text-action-foreground">
          ปรับราคา ชื่อ หมวดหมู่ และสถานะการขาย
          โดยไม่เปลี่ยนราคาที่บันทึกในออเดอร์เก่า
        </p>
        <p class="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed text-foreground">
          การเก็บสินค้าเข้าคลัง (Archive) จะนำออกจากเมนูลูกค้าถาวร
          แต่ยังคงประวัติออเดอร์และสต็อก ไม่มีการรับชำระเงินจากหน้านี้
        </p>
      </header>

      @if (loading()) {
        <p
          role="status"
          class="rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground"
        >
          กำลังตรวจสอบสิทธิ์และโหลดสินค้า...
        </p>
      } @else if (!canManage()) {
        <p
          class="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground"
          role="alert"
        >
          {{ error() || "เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่แก้ไขเมนูได้" }}
        </p>
      } @else {
        @if (error()) {
          <p
            class="rounded-xl border border-destructive/30 bg-danger-soft p-4 text-sm leading-relaxed text-foreground"
            role="alert"
          >
            {{ error() }}
          </p>
        }
        @if (success()) {
          <p
            class="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed text-foreground"
            role="status"
          >
            {{ success() }}
          </p>
        }

        <details
          class="my-5 overflow-hidden rounded-xl border border-border bg-card"
        >
          <summary
            class="flex min-h-14 cursor-pointer flex-wrap items-center justify-between gap-2 p-4 font-semibold focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span>เพิ่มหมวดหมู่หรือสินค้าใหม่</span>
            <span class="text-muted-foreground">แตะเพื่อเปิดแบบฟอร์ม</span>
          </summary>
          <div class="grid gap-4 p-4 md:grid-cols-2">
            <form hlmCard size="sm" class="min-w-0" (ngSubmit)="addCategory()">
              <h2 class="text-lg font-semibold">เพิ่มหมวดหมู่</h2>
              <label hlmLabel for="category-name">ชื่อหมวดหมู่</label>
              <input
                hlmInput
                class="min-h-11"
                id="category-name"
                name="categoryName"
                [(ngModel)]="newCategory.name"
                maxlength="120"
                required
                placeholder="เช่น อาหารจานเดียว"
                [disabled]="saving()"
              />
              <label hlmLabel for="category-slug"
                >รหัสหมวดหมู่ (ภาษาอังกฤษ)</label
              >
              <input
                hlmInput
                class="min-h-11"
                id="category-slug"
                name="categorySlug"
                [(ngModel)]="newCategory.slug"
                maxlength="48"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="thai-food"
                [disabled]="saving()"
              />
              <button
                hlmBtn
                type="submit"
                [disabled]="saving()"
                class="min-h-11"
              >
                เพิ่มหมวดหมู่
              </button>
            </form>

            <form hlmCard size="sm" class="min-w-0" (ngSubmit)="addProduct()">
              <h2 class="text-lg font-semibold">เพิ่มสินค้า</h2>
              <label hlmLabel for="new-product-name">ชื่อสินค้า</label>
              <input
                hlmInput
                class="min-h-11"
                id="new-product-name"
                name="newProductName"
                [(ngModel)]="newProduct.name"
                maxlength="160"
                required
                placeholder="เช่น ข้าวผัด"
                [disabled]="saving()"
              />
              <label hlmLabel for="new-product-category">หมวดหมู่</label>
              <hlm-native-select
                class="block w-full"
                selectId="new-product-category"
                name="newProductCategory"
                [(ngModel)]="newProduct.categoryId"
                required
                [disabled]="saving()"
              >
                <option value="" disabled>เลือกหมวดหมู่</option>
                @for (category of categories(); track category.id) {
                  <option [value]="category.id">{{ category.name }}</option>
                }
              </hlm-native-select>
              <label hlmLabel for="new-product-price">ราคาขาย (บาท)</label>
              <input
                hlmInput
                class="min-h-11"
                id="new-product-price"
                name="newProductPrice"
                [(ngModel)]="newProduct.priceBaht"
                required
                inputmode="decimal"
                placeholder="59.00"
                [disabled]="saving()"
              />
              <button
                hlmBtn
                type="submit"
                [disabled]="saving() || categories().length === 0"
                class="min-h-11"
              >
                เพิ่มสินค้า
              </button>
            </form>
          </div>
        </details>

        <section
          hlmCard
          class="grid min-w-0 gap-4 p-4 md:p-6"
          aria-labelledby="category-editor-title"
        >
          <h2 id="category-editor-title" class="text-lg font-semibold">
            แก้ไขหมวดหมู่ที่มีอยู่
          </h2>
          @for (category of categories(); track category.id) {
            <div
              class="grid gap-3 border-b border-border pb-4 last:border-0 last:pb-0"
            >
              <div
                class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span class="min-w-0 break-words font-medium text-foreground"
                  >{{ category.name }} ({{ category.slug }})</span
                >
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  class="min-h-11"
                  [disabled]="saving()"
                  (click)="beginCategoryEdit(category)"
                >
                  แก้ไขหมวดหมู่
                </button>
              </div>
              @if (categoryEditId() === category.id) {
                <form
                  class="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4"
                  (ngSubmit)="saveCategoryEdit()"
                >
                  <label hlmLabel for="category-edit-name">ชื่อหมวดหมู่</label>
                  <input
                    hlmInput
                    class="min-h-11"
                    id="category-edit-name"
                    name="editCategoryName"
                    [(ngModel)]="categoryEdit.name"
                    required
                    maxlength="120"
                    [disabled]="saving()"
                  />
                  <label hlmLabel for="category-edit-slug">รหัสหมวดหมู่</label>
                  <input
                    hlmInput
                    class="min-h-11"
                    id="category-edit-slug"
                    name="editCategorySlug"
                    [(ngModel)]="categoryEdit.slug"
                    required
                    maxlength="48"
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    [disabled]="saving()"
                  />
                  <div class="flex flex-wrap gap-2">
                    <button
                      hlmBtn
                      type="submit"
                      [disabled]="saving()"
                      class="min-h-11"
                    >
                      บันทึกหมวดหมู่
                    </button>
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      class="min-h-11"
                      [disabled]="saving()"
                      (click)="categoryEditId.set(null)"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </form>
              }
            </div>
          } @empty {
            <p>ยังไม่มีหมวดหมู่</p>
          }
        </section>

        <section
          class="catalog-products mt-5 grid min-w-0 gap-4 rounded-xl border border-border bg-card p-4 shadow-sm md:p-6"
          aria-labelledby="products-title"
        >
          <div class="flex flex-wrap justify-between gap-4 border-b pb-4">
            <div>
              <h2 id="products-title">สินค้าทั้งหมด</h2>
              <p>
                แสดง {{ products().length }} รายการในหน้านี้ ·
                ราคาที่แสดงเป็นบาท
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                hlmBtn
                type="button"
                variant="outline"
                class="min-h-11"
                (click)="toggleArchived()"
              >
                {{
                  showArchived() ? "ซ่อนสินค้าเก็บถาวร" : "แสดงสินค้าเก็บถาวร"
                }}
              </button>
              <button
                hlmBtn
                type="button"
                variant="outline"
                class="min-h-11"
                (click)="refresh()"
                [disabled]="saving()"
              >
                โหลดข้อมูลใหม่
              </button>
            </div>
          </div>
          <div
            class="grid min-w-0 items-end gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
          >
            <div class="grid min-w-0 gap-2">
              <label hlmLabel for="catalog-search">ค้นหาชื่อสินค้า</label>
              <input
                hlmInput
                class="min-h-11"
                id="catalog-search"
                name="catalogSearch"
                [(ngModel)]="searchDraft"
                (keyup.enter)="applyFilters()"
                placeholder="พิมพ์ชื่อสินค้า..."
                autocomplete="off"
              />
            </div>
            <div class="grid min-w-0 gap-2">
              <label hlmLabel for="catalog-category-filter"
                >กรองตามหมวดหมู่</label
              >
              <hlm-native-select
                class="block w-full"
                selectId="catalog-category-filter"
                name="catalogCategoryFilter"
                [(ngModel)]="categoryFilter"
                (ngModelChange)="applyFilters()"
              >
                <option value="">ทุกหมวดหมู่</option>
                @for (category of categories(); track category.id) {
                  <option [value]="category.id">{{ category.name }}</option>
                }
              </hlm-native-select>
            </div>
            <button
              hlmBtn
              type="button"
              class="min-h-11 w-full md:w-auto"
              (click)="applyFilters()"
              [disabled]="pageLoading() || saving()"
            >
              ค้นหาสินค้า
            </button>
          </div>
          <p
            class="my-2 text-sm tabular-nums text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            หน้า {{ page() }} · สูงสุด {{ pageSize }} รายการต่อหน้า
            @if (pageLoading()) {
              · กำลังโหลด...
            }
          </p>

          @for (product of displayedProducts(); track product.id) {
            <article
              hlmCard
              size="sm"
              class="catalog-product min-w-0 gap-2 rounded-xl p-3"
            >
              <div
                class="catalog-product-row grid min-w-0 items-center gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
              >
                <div
                  class="flex min-w-0 items-center gap-3 sm:col-span-2 xl:col-span-1"
                >
                  @if (product.hasImage) {
                    <img
                      [src]="imageUrl(product)"
                      [alt]="'รูปสินค้า ' + product.name"
                      class="catalog-media-preview size-16 shrink-0 rounded-xl border border-border bg-muted object-cover"
                      loading="lazy"
                    />
                  } @else {
                    <span
                      class="grid size-16 shrink-0 place-items-center rounded-xl border border-border bg-muted text-xs font-medium text-muted-foreground"
                      aria-hidden="true"
                    >
                      ไม่มีรูป
                    </span>
                  }
                  <div class="min-w-0 flex-1">
                    <h3 class="break-words font-semibold">
                      {{ product.name }}
                    </h3>
                    <p class="mt-1 text-sm text-muted-foreground">
                      {{ categoryName(product.categoryId) }}
                    </p>
                    <p class="font-semibold tabular-nums text-foreground">
                      {{ money(product.priceSatang) }} บาท
                    </p>
                    <span
                      hlmBadge
                      variant="outline"
                      [class.bg-served]="
                        product.available && !product.archivedAt
                      "
                    >
                      {{
                        product.archivedAt
                          ? "เก็บถาวร"
                          : product.available
                            ? "เปิดขาย"
                            : "ปิดขายชั่วคราว"
                      }}
                    </span>
                  </div>
                </div>
                @if (!product.archivedAt) {
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      [attr.aria-expanded]="imageProductId() === product.id"
                      [attr.aria-controls]="'image-panel-' + product.id"
                      [disabled]="saving()"
                      (click)="toggleImageEditor(product)"
                    >
                      รูปสินค้า
                    </button>
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      [attr.aria-expanded]="modifierProductId() === product.id"
                      [attr.aria-controls]="'modifier-panel-' + product.id"
                      [disabled]="saving()"
                      (click)="toggleModifierEditor(product)"
                    >
                      ตัวเลือกสินค้า
                    </button>
                  </div>
                  <div
                    class="catalog-product-actions flex min-w-0 flex-wrap items-center gap-2 xl:justify-end"
                  >
                    <button
                      hlmBtn
                      type="button"
                      [disabled]="saving()"
                      (click)="beginEdit(product)"
                    >
                      แก้ไข
                    </button>
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      [disabled]="saving()"
                      (click)="toggleAvailability(product)"
                    >
                      {{ product.available ? "ปิดขาย" : "เปิดขาย" }}
                    </button>
                    <details class="min-w-0">
                      <summary
                        class="min-h-11 min-w-11 w-fit cursor-pointer rounded-lg border border-input bg-card px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        เพิ่มเติม
                      </summary>
                      <div class="mt-2">
                        <button
                          hlmBtn
                          type="button"
                          variant="destructive"
                          [disabled]="saving()"
                          (click)="archive(product)"
                        >
                          เก็บถาวร
                        </button>
                      </div>
                    </details>
                  </div>
                }
              </div>
              @if (!product.archivedAt && imageProductId() === product.id) {
                <div [attr.id]="'image-panel-' + product.id">
                  <div
                    class="mt-3 grid min-w-0 gap-3 rounded-xl border border-border bg-muted/30 p-4"
                    aria-label="รูปภาพสินค้า"
                  >
                    <div class="grid min-w-0 max-w-sm gap-3">
                      <label
                        hlmLabel
                        [attr.for]="'catalog-media-' + product.id"
                      >
                        {{
                          product.hasImage
                            ? "เปลี่ยนรูปสินค้า"
                            : "เพิ่มรูปสินค้า"
                        }}
                      </label>
                      <input
                        [id]="'catalog-media-' + product.id"
                        type="file"
                        class="block min-h-11 w-full min-w-0 max-w-full rounded-xl border border-input bg-card p-2 text-sm text-foreground"
                        accept="image/jpeg,image/png,image/webp"
                        [disabled]="saving()"
                        (change)="uploadImage($event, product)"
                      />
                      @if (product.hasImage) {
                        <button
                          hlmBtn
                          type="button"
                          variant="outline"
                          class="min-h-11"
                          [disabled]="saving()"
                          (click)="removeImage(product)"
                        >
                          ลบรูปสินค้า
                        </button>
                      }
                    </div>
                    <p
                      class="max-w-prose text-sm leading-relaxed text-muted-foreground"
                    >
                      JPG / PNG / WebP · แปลงเป็น WebP ก่อนส่ง · สูงสุด 192 KB
                    </p>
                  </div>
                </div>
              }
              @if (!product.archivedAt) {
                @if (modifierProductId() === product.id) {
                  <section
                    class="catalog-modifier-panel grid gap-4 rounded-2xl border border-border bg-card p-4 md:p-6"
                    [attr.id]="'modifier-panel-' + product.id"
                  >
                    <h4 class="text-lg font-semibold text-foreground">
                      ตัวเลือกเพิ่มเติมของ {{ product.name }}
                    </h4>
                    <p class="text-sm leading-6 text-muted-foreground">
                      กำหนดแยกเฉพาะเมนูนี้ เช่น ระดับความหวาน (เลือก 1 อย่าง)
                      หรือเพิ่มท็อปปิ้งราคา +10 บาท (เลือกได้หลายอย่าง)
                      โดยไม่กระทบตัวเลือกของเมนูอื่น
                    </p>
                    <form
                      class="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4"
                      (ngSubmit)="addGroup(product)"
                    >
                      <h5 class="font-semibold text-foreground">
                        เพิ่มกลุ่มตัวเลือก
                      </h5>
                      <div
                        class="flex flex-wrap gap-2"
                        role="group"
                        aria-label="รูปแบบการเลือก"
                      >
                        <button
                          hlmBtn
                          type="button"
                          variant="outline"
                          class="min-h-11"
                          [disabled]="saving()"
                          (click)="setNewGroupSelectionMode('single')"
                        >
                          เลือกอย่างเดียว (บังคับ)
                        </button>
                        <button
                          hlmBtn
                          type="button"
                          variant="outline"
                          class="min-h-11"
                          [disabled]="saving()"
                          (click)="setNewGroupSelectionMode('multiple')"
                        >
                          เลือกได้หลายอย่าง (ไม่บังคับ)
                        </button>
                      </div>
                      <label hlmLabel for="new-group-name">ชื่อกลุ่ม</label>
                      <input
                        hlmInput
                        id="new-group-name"
                        name="newGroupName"
                        placeholder="เช่น ระดับความหวาน หรือเพิ่มท็อปปิ้ง"
                        [(ngModel)]="newGroup.name"
                        required
                        maxlength="120"
                        [disabled]="saving()"
                      />
                      <label hlmLabel for="new-group-slug">รหัสกลุ่ม</label>
                      <input
                        hlmInput
                        id="new-group-slug"
                        name="newGroupSlug"
                        [(ngModel)]="newGroup.slug"
                        required
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        maxlength="48"
                        [disabled]="saving()"
                      />
                      <label hlmLabel for="new-group-min">เลือกขั้นต่ำ</label>
                      <input
                        hlmInput
                        id="new-group-min"
                        name="newGroupMin"
                        type="number"
                        min="0"
                        max="8"
                        [(ngModel)]="newGroup.minSelect"
                        [disabled]="saving()"
                      />
                      <label hlmLabel for="new-group-max">เลือกสูงสุด</label>
                      <input
                        hlmInput
                        id="new-group-max"
                        name="newGroupMax"
                        type="number"
                        min="1"
                        max="8"
                        [(ngModel)]="newGroup.maxSelect"
                        [disabled]="saving()"
                      />
                      <button
                        hlmBtn
                        type="submit"
                        class="min-h-11"
                        [disabled]="saving()"
                      >
                        เพิ่มกลุ่ม
                      </button>
                    </form>
                    @for (group of groupsFor(product.id); track group.id) {
                      <div
                        class="grid min-w-0 gap-3 border-t border-border pt-4"
                      >
                        <div
                          class="flex flex-wrap items-center justify-between gap-3"
                        >
                          <h5 class="font-semibold text-foreground">
                            {{ group.name }}
                            <span hlmBadge variant="secondary" class="ms-2">
                              {{
                                group.maxSelect === 1
                                  ? "เลือกอย่างเดียว"
                                  : "เลือกได้หลายอย่าง"
                              }}
                            </span>
                            <span
                              class="text-sm font-normal text-muted-foreground"
                            >
                              {{
                                group.minSelect === 0
                                  ? "ไม่บังคับ"
                                  : "ต้องเลือก"
                              }}
                              · จำนวน {{ group.minSelect }}–{{
                                group.maxSelect
                              }}
                            </span>
                          </h5>
                          <button
                            type="button"
                            hlmBtn
                            variant="outline"
                            class="min-h-11"
                            [disabled]="saving()"
                            (click)="beginGroupEdit(group)"
                          >
                            แก้ไขกลุ่ม
                          </button>
                        </div>
                        @if (groupEditId() === group.id) {
                          <form
                            class="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4"
                            (ngSubmit)="saveGroupEdit(product)"
                          >
                            <label hlmLabel for="group-edit-name"
                              >ชื่อกลุ่ม</label
                            >
                            <input
                              hlmInput
                              id="group-edit-name"
                              name="groupEditName"
                              [(ngModel)]="groupEdit.name"
                              required
                              maxlength="120"
                              [disabled]="saving()"
                            />
                            <label hlmLabel for="group-edit-slug"
                              >รหัสกลุ่ม</label
                            >
                            <input
                              hlmInput
                              id="group-edit-slug"
                              name="groupEditSlug"
                              [(ngModel)]="groupEdit.slug"
                              required
                              maxlength="48"
                              pattern="[a-z0-9]+(-[a-z0-9]+)*"
                              [disabled]="saving()"
                            />
                            <label hlmLabel for="group-edit-min"
                              >เลือกขั้นต่ำ</label
                            >
                            <input
                              hlmInput
                              id="group-edit-min"
                              name="groupEditMin"
                              type="number"
                              min="0"
                              max="8"
                              [(ngModel)]="groupEdit.minSelect"
                              [disabled]="saving()"
                            />
                            <label hlmLabel for="group-edit-max"
                              >เลือกสูงสุด</label
                            >
                            <input
                              hlmInput
                              id="group-edit-max"
                              name="groupEditMax"
                              type="number"
                              min="1"
                              max="8"
                              [(ngModel)]="groupEdit.maxSelect"
                              [disabled]="saving()"
                            />
                            <div class="flex flex-wrap gap-2">
                              <button
                                hlmBtn
                                type="submit"
                                class="min-h-11"
                                [disabled]="saving()"
                              >
                                บันทึกกลุ่ม
                              </button>
                              <button
                                type="button"
                                hlmBtn
                                variant="outline"
                                class="min-h-11"
                                [disabled]="saving()"
                                (click)="groupEditId.set(null)"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          </form>
                        }
                        @for (option of optionsFor(group.id); track option.id) {
                          <div
                            class="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border py-3"
                          >
                            <span class="text-sm text-foreground">
                              {{ option.name }} ·
                              {{ option.priceDeltaSatang > 0 ? "+" : ""
                              }}{{ money(option.priceDeltaSatang) }} บาท ·
                              {{
                                option.available
                                  ? "เปิดให้เลือก"
                                  : "ปิดให้เลือก"
                              }}
                            </span>
                            <button
                              type="button"
                              hlmBtn
                              variant="outline"
                              class="min-h-11"
                              [disabled]="saving()"
                              (click)="beginOptionEdit(option)"
                            >
                              แก้ไขตัวเลือก
                            </button>
                            @if (optionEditId() === option.id) {
                              <form
                                class="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4"
                                (ngSubmit)="saveOptionEdit(product)"
                              >
                                <label hlmLabel for="option-edit-name"
                                  >ชื่อตัวเลือก</label
                                >
                                <input
                                  hlmInput
                                  id="option-edit-name"
                                  name="optionEditName"
                                  [(ngModel)]="optionEdit.name"
                                  maxlength="120"
                                  required
                                  [disabled]="saving()"
                                />
                                <label hlmLabel for="option-edit-price"
                                  >ราคาเพิ่ม/ลด (บาท)</label
                                >
                                <input
                                  hlmInput
                                  id="option-edit-price"
                                  name="optionEditPrice"
                                  [(ngModel)]="optionEdit.priceDeltaBaht"
                                  required
                                  inputmode="decimal"
                                  [disabled]="saving()"
                                />
                                <label
                                  hlmLabel
                                  class="flex min-h-11 min-w-11 cursor-pointer items-center gap-2"
                                >
                                  <input
                                    class="size-5 accent-primary-line"
                                    type="checkbox"
                                    name="optionEditAvailable"
                                    [(ngModel)]="optionEdit.available"
                                    [disabled]="saving()"
                                  />
                                  เปิดให้เลือก
                                </label>
                                <div class="flex flex-wrap gap-2">
                                  <button
                                    hlmBtn
                                    type="submit"
                                    class="min-h-11"
                                    [disabled]="saving()"
                                  >
                                    บันทึกตัวเลือก
                                  </button>
                                  <button
                                    type="button"
                                    hlmBtn
                                    variant="outline"
                                    class="min-h-11"
                                    [disabled]="saving()"
                                    (click)="optionEditId.set(null)"
                                  >
                                    ยกเลิก
                                  </button>
                                </div>
                              </form>
                            }
                          </div>
                        }
                        <button
                          type="button"
                          hlmBtn
                          variant="outline"
                          class="min-h-11"
                          [disabled]="saving()"
                          [attr.aria-expanded]="newOptionGroupId() === group.id"
                          [attr.aria-controls]="'new-option-form-' + group.id"
                          (click)="beginNewOption(group.id)"
                        >
                          {{
                            newOptionGroupId() === group.id
                              ? "ยกเลิกเพิ่มตัวเลือก"
                              : "เพิ่มตัวเลือก"
                          }}
                        </button>
                        @if (newOptionGroupId() === group.id) {
                          @if (newOptionDrafts[group.id]; as draft) {
                            <form
                              class="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4"
                              [attr.id]="'new-option-form-' + group.id"
                              (ngSubmit)="addOption(product, group)"
                            >
                              <h5 class="font-semibold text-foreground">
                                เพิ่มตัวเลือกใน {{ group.name }}
                              </h5>
                              <label hlmLabel for="new-option-name"
                                >ชื่อตัวเลือก</label
                              >
                              <input
                                hlmInput
                                id="new-option-name"
                                name="newOptionName"
                                placeholder="เช่น หวานน้อย หวาน 100% หวานมาก หรือไข่มุก"
                                [(ngModel)]="draft.name"
                                maxlength="120"
                                required
                                [disabled]="saving()"
                              />
                              <label hlmLabel for="new-option-price"
                                >ราคาเพิ่ม/ลด (บาท)</label
                              >
                              <input
                                hlmInput
                                id="new-option-price"
                                name="newOptionPrice"
                                placeholder="เช่น 10.00 (เพิ่ม 10 บาท) หรือ 0.00"
                                [(ngModel)]="draft.priceDeltaBaht"
                                required
                                inputmode="decimal"
                                [disabled]="saving()"
                              />
                              <button
                                hlmBtn
                                type="submit"
                                class="min-h-11"
                                [disabled]="saving()"
                              >
                                บันทึกตัวเลือกใหม่
                              </button>
                            </form>
                          }
                        }
                      </div>
                    } @empty {
                      <p class="text-sm text-muted-foreground">
                        เมนูนี้ยังไม่มี Additional
                        ลูกค้าจะสั่งโดยไม่ต้องเลือกตัวเลือกเพิ่มเติม
                      </p>
                    }
                  </section>
                }
              }
              @if (editId() === product.id && !product.archivedAt) {
                <form
                  class="catalog-edit mt-3 grid min-w-0 max-w-2xl gap-3 rounded-xl border border-border bg-muted/30 p-4"
                  (ngSubmit)="saveEdit()"
                >
                  <p class="text-sm leading-6 text-muted-foreground">
                    แก้ไขข้อมูลสินค้า · ตรวจสอบ Revision {{ edit.revision }}
                  </p>
                  <label hlmLabel for="edit-product-name">ชื่อสินค้า</label>
                  <input
                    hlmInput
                    class="min-h-11"
                    id="edit-product-name"
                    name="editName"
                    [(ngModel)]="edit.name"
                    required
                    maxlength="160"
                    [disabled]="saving()"
                  />
                  <label hlmLabel for="edit-product-category">หมวดหมู่</label>
                  <hlm-native-select
                    class="block w-full"
                    selectId="edit-product-category"
                    name="editCategory"
                    [(ngModel)]="edit.categoryId"
                    required
                    [disabled]="saving()"
                  >
                    @for (category of categories(); track category.id) {
                      <option [value]="category.id">{{ category.name }}</option>
                    }
                  </hlm-native-select>
                  <label hlmLabel for="edit-product-price"
                    >ราคาขายใหม่ (บาท)</label
                  >
                  <input
                    hlmInput
                    class="min-h-11"
                    id="edit-product-price"
                    name="editPrice"
                    [(ngModel)]="edit.priceBaht"
                    required
                    inputmode="decimal"
                    [disabled]="saving()"
                  />
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      hlmBtn
                      type="submit"
                      [disabled]="saving()"
                      class="min-h-11"
                    >
                      บันทึกการแก้ไข
                    </button>
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      class="min-h-11"
                      [disabled]="saving()"
                      (click)="cancelEdit()"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </form>
              }
            </article>
          } @empty {
            <p
              class="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground"
              role="status"
            >
              ไม่พบสินค้าที่ตรงกับเงื่อนไข
            </p>
          }
          @if (page() > 1 || hasMore()) {
            <nav
              class="flex flex-wrap items-center justify-center gap-3 border-t border-border pt-4"
              aria-label="แบ่งหน้ารายการสินค้า"
            >
              <button
                hlmBtn
                type="button"
                variant="outline"
                class="min-h-11"
                [disabled]="saving() || pageLoading() || page() <= 1"
                (click)="previousPage()"
              >
                ← ก่อนหน้า
              </button>
              <span
                class="font-semibold tabular-nums text-foreground"
                aria-live="polite"
                >หน้า {{ page() }}</span
              >
              <button
                hlmBtn
                type="button"
                variant="outline"
                class="min-h-11"
                [disabled]="saving() || pageLoading() || !hasMore()"
                (click)="nextPage()"
              >
                ถัดไป →
              </button>
            </nav>
          }
        </section>
      }
    </section>
  `,
})
export class MerchantCatalogPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(MerchantCatalogApi);
  private readonly orders = inject(MerchantOrderApi);
  private readonly document = inject(DOCUMENT);

  readonly categories = signal<CatalogCategory[]>([]);
  readonly products = signal<CatalogProduct[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly canManage = signal(false);
  readonly showArchived = signal(false);
  readonly error = signal("");
  readonly success = signal("");
  readonly editId = signal<string | null>(null);
  readonly imageProductId = signal<string | null>(null);
  readonly page = signal(1);
  readonly pageSize = CATALOG_PAGE_SIZE;
  readonly categoryEditId = signal<string | null>(null);
  readonly modifierProductId = signal<string | null>(null);
  readonly groupEditId = signal<string | null>(null);
  readonly optionEditId = signal<string | null>(null);
  readonly newOptionGroupId = signal<string | null>(null);
  readonly modifierGroups = signal<CatalogModifierGroup[]>([]);
  readonly modifierOptions = signal<CatalogModifierOption[]>([]);
  private categoryBefore: CatalogCategory | null = null;
  private groupBefore: CatalogModifierGroup | null = null;
  private optionBefore: CatalogModifierOption | null = null;
  categoryEdit = { name: "", slug: "" };
  newGroup = { name: "", slug: "", minSelect: 0, maxSelect: 1 };
  groupEdit = { name: "", slug: "", minSelect: 0, maxSelect: 1 };
  newOptionDrafts: Record<string, { name: string; priceDeltaBaht: string }> =
    {};
  optionEdit = { name: "", priceDeltaBaht: "0.00", available: true };
  readonly pageLoading = signal(false);
  readonly hasMore = signal(false);
  readonly nextCursor = signal<CatalogCursor | null>(null);
  private cursorHistory: CatalogCursor[] = [];
  private latestRequest = 0;

  searchDraft = "";
  search = "";
  categoryFilter = "";
  newCategory = { name: "", slug: "" };
  newProduct = { name: "", categoryId: "", priceBaht: "" };
  edit = { name: "", categoryId: "", priceBaht: "", revision: 0 };

  private get tenantId(): string {
    return this.route.snapshot.paramMap.get("tenantId") ?? "";
  }
  private get storeId(): string {
    return this.route.snapshot.paramMap.get("storeId") ?? "";
  }

  ngOnInit(): void {
    void this.initialize();
  }

  setNewGroupSelectionMode(mode: "single" | "multiple"): void {
    // A new object identity makes Angular's model and form controls reconcile
    // their values after the interactive Spartan button changes the preset.
    this.newGroup =
      mode === "single"
        ? { ...this.newGroup, minSelect: 1, maxSelect: 1 }
        : { ...this.newGroup, minSelect: 0, maxSelect: 3 };
  }

  async initialize(): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      const { stores } = await this.orders.stores();
      const selected = stores.find(
        (store) =>
          store.tenantId === this.tenantId && store.storeId === this.storeId,
      );
      if (
        !selected ||
        (selected.role !== "owner" && selected.role !== "manager")
      ) {
        this.error.set("บัญชีนี้ไม่ได้รับสิทธิ์แก้ไขสินค้าของร้านนี้");
        return;
      }
      this.canManage.set(true);
      await this.refresh();
    } catch {
      this.error.set(
        "ไม่สามารถตรวจสอบสิทธิ์หรือโหลดข้อมูลได้ กรุณาเข้าสู่ระบบอีกครั้ง",
      );
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    if (!this.canManage()) return;
    const version = ++this.latestRequest;
    this.pageLoading.set(true);
    try {
      const cursor =
        this.page() > 1 ? (this.cursorHistory[this.page() - 2] ?? null) : null;
      const result = await this.api.page(this.tenantId, this.storeId, {
        search: this.search,
        categoryId: this.categoryFilter,
        includeArchived: this.showArchived(),
        cursor,
      });
      if (version !== this.latestRequest) return;
      this.categories.set(result.categories);
      this.products.set(result.products);
      this.modifierGroups.set(result.modifierGroups ?? []);
      this.modifierOptions.set(result.modifierOptions ?? []);
      this.hasMore.set(result.hasMore);
      this.nextCursor.set(result.nextCursor);
      if (
        this.categoryFilter &&
        !result.categories.some((c) => c.id === this.categoryFilter)
      ) {
        this.categoryFilter = "";
        this.resetPage();
        await this.refresh();
        return;
      }
      if (result.products.length === 0 && this.page() > 1) {
        this.cursorHistory.pop();
        this.page.update((current) => current - 1);
        await this.refresh();
        return;
      }
      if (!result.categories.some((c) => c.id === this.newProduct.categoryId)) {
        this.newProduct.categoryId = result.categories[0]?.id ?? "";
      }
      this.editId.set(null);
      this.categoryEditId.set(null);
      this.groupEditId.set(null);
      this.optionEditId.set(null);
      this.newOptionGroupId.set(null);
      this.newOptionDrafts = {};
    } catch {
      if (version === this.latestRequest) {
        this.error.set("ไม่สามารถโหลดข้อมูลเมนูล่าสุดได้");
      }
    } finally {
      if (version === this.latestRequest) this.pageLoading.set(false);
    }
  }

  categoryName(id: string): string {
    return (
      this.categories().find((category) => category.id === id)?.name ??
      "ไม่พบหมวดหมู่"
    );
  }

  money(satang: number): string {
    return (satang / 100).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  displayedProducts(): CatalogProduct[] {
    return this.products();
  }

  resetPage(): void {
    this.cursorHistory = [];
    this.page.set(1);
    this.editId.set(null);
  }

  applyFilters(): void {
    this.search = this.searchDraft.trim();
    this.resetPage();
    void this.refresh();
  }

  previousPage(): void {
    if (this.saving() || this.pageLoading() || this.page() <= 1) return;
    this.cursorHistory.pop();
    this.page.update((current) => current - 1);
    this.editId.set(null);
    void this.refresh();
  }

  nextPage(): void {
    const cursor = this.nextCursor();
    if (this.saving() || this.pageLoading() || !this.hasMore() || !cursor)
      return;
    this.cursorHistory.push(cursor);
    this.page.update((current) => current + 1);
    this.editId.set(null);
    void this.refresh();
  }

  toggleArchived(): void {
    this.showArchived.update((value) => !value);
    this.applyFilters();
  }

  private async mutate(
    work: () => Promise<unknown>,
    message: string,
  ): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    this.error.set("");
    this.success.set("");
    try {
      await work();
      await this.refresh();
      this.success.set(message);
      return true;
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse && error.status === 409
          ? "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดรายการล่าสุดและตรวจสอบก่อนบันทึก"
          : error instanceof HttpErrorResponse && error.status === 403
            ? "ไม่มีสิทธิ์หรือ Session หมดอายุ กรุณาเข้าสู่ระบบใหม่"
            : error instanceof Error && !(error instanceof HttpErrorResponse)
              ? error.message
              : "บันทึกรายการไม่สำเร็จ กรุณาตรวจสอบข้อมูลและลองใหม่",
      );
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async addCategory(): Promise<void> {
    const name = this.newCategory.name.trim();
    const slug = this.newCategory.slug.trim();
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      this.error.set("กรุณากรอกชื่อและรหัสหมวดหมู่ภาษาอังกฤษให้ถูกต้อง");
      return;
    }
    if (
      await this.mutate(
        () => this.api.createCategory(this.tenantId, this.storeId, name, slug),
        "เพิ่มหมวดหมู่แล้ว",
      )
    ) {
      this.newCategory = { name: "", slug: "" };
    }
  }

  async addProduct(): Promise<void> {
    const priceSatang = parseBaht(this.newProduct.priceBaht);
    if (
      !this.newProduct.name.trim() ||
      !this.newProduct.categoryId ||
      priceSatang === null
    ) {
      this.error.set(
        "กรุณาตรวจสอบชื่อ หมวดหมู่ และราคา (บาท ทศนิยมไม่เกินสองตำแหน่ง)",
      );
      return;
    }
    if (
      await this.mutate(
        () =>
          this.api.createProduct(
            this.tenantId,
            this.storeId,
            this.newProduct.name.trim(),
            this.newProduct.categoryId,
            priceSatang,
          ),
        "เพิ่มสินค้าแล้ว",
      )
    ) {
      this.newProduct.name = "";
      this.newProduct.priceBaht = "";
    }
  }

  imageUrl(product: CatalogProduct): string {
    return this.api.productImageUrl(
      this.tenantId,
      this.storeId,
      product.id,
      product.revision,
    );
  }

  async uploadImage(event: Event, product: CatalogProduct): Promise<void> {
    if (!(event.target instanceof HTMLInputElement)) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await this.mutate(async () => {
      const webp = await prepareProductWebp(file, this.document);
      await this.api.uploadImage(
        this.tenantId,
        this.storeId,
        product.id,
        product.revision,
        webp,
      );
    }, "บันทึกรูปสินค้าแล้ว");
  }

  async removeImage(product: CatalogProduct): Promise<void> {
    if (
      !this.document.defaultView?.confirm(
        "ลบรูปภาพสินค้า " + product.name + " ?",
      )
    )
      return;
    await this.mutate(
      () =>
        this.api.deleteImage(
          this.tenantId,
          this.storeId,
          product.id,
          product.revision,
        ),
      "ลบรูปสินค้าแล้ว",
    );
  }

  beginEdit(product: CatalogProduct): void {
    this.error.set("");
    this.success.set("");
    this.editId.set(product.id);
    this.edit = {
      name: product.name,
      categoryId: product.categoryId,
      priceBaht: bahtInput(product.priceSatang),
      revision: product.revision,
    };
  }

  cancelEdit(): void {
    this.editId.set(null);
  }

  async saveEdit(): Promise<void> {
    const productId = this.editId();
    const priceSatang = parseBaht(this.edit.priceBaht);
    if (
      !productId ||
      !this.edit.name.trim() ||
      !this.edit.categoryId ||
      priceSatang === null
    ) {
      this.error.set("กรุณาตรวจสอบชื่อ หมวดหมู่ และราคาสินค้า");
      return;
    }
    await this.mutate(
      () =>
        this.api.editProduct(this.tenantId, this.storeId, productId, {
          name: this.edit.name.trim(),
          categoryId: this.edit.categoryId,
          priceSatang,
          expectedRevision: this.edit.revision,
        }),
      "บันทึกข้อมูลสินค้าแล้ว ออเดอร์เดิมยังใช้ราคาที่บันทึกไว้",
    );
  }

  async toggleAvailability(product: CatalogProduct): Promise<void> {
    await this.mutate(
      () =>
        this.api.availability(
          this.tenantId,
          this.storeId,
          product.id,
          !product.available,
        ),
      product.available ? "ปิดขายสินค้าชั่วคราวแล้ว" : "เปิดขายสินค้าแล้ว",
    );
  }

  async archive(product: CatalogProduct): Promise<void> {
    const approved = this.document.defaultView?.confirm(
      `เก็บสินค้า "${product.name}" ถาวรจากเมนู? สินค้าเก่าจะยังอยู่ในประวัติออเดอร์ แต่ไม่สามารถเปิดขายใหม่ได้`,
    );
    if (!approved) return;
    await this.mutate(
      () =>
        this.api.archiveProduct(
          this.tenantId,
          this.storeId,
          product.id,
          product.revision,
        ),
      "เก็บสินค้าถาวรแล้ว และคงประวัติออเดอร์เดิม",
    );
  }
  beginCategoryEdit(category: CatalogCategory): void {
    this.categoryBefore = { ...category };
    this.categoryEdit = { name: category.name, slug: category.slug };
    this.categoryEditId.set(category.id);
  }

  async saveCategoryEdit(): Promise<void> {
    const previous = this.categoryBefore;
    if (!previous || !this.categoryEdit.name.trim()) return;
    await this.mutate(
      () =>
        this.api.updateCategory(
          this.tenantId,
          this.storeId,
          previous.id,
          previous,
          {
            name: this.categoryEdit.name.trim(),
            slug: this.categoryEdit.slug.trim(),
          },
        ),
      "บันทึกหมวดหมู่แล้ว",
    );
  }

  toggleImageEditor(product: CatalogProduct): void {
    this.imageProductId.update((id) => (id === product.id ? null : product.id));
  }

  toggleModifierEditor(product: CatalogProduct): void {
    this.modifierProductId.update((id) =>
      id === product.id ? null : product.id,
    );
    this.groupEditId.set(null);
    this.optionEditId.set(null);
    this.newOptionGroupId.set(null);
    this.newOptionDrafts = {};
  }

  beginNewOption(groupId: string): void {
    const previous = this.newOptionGroupId();
    if (previous) delete this.newOptionDrafts[previous];
    if (previous === groupId) {
      this.newOptionGroupId.set(null);
      return;
    }
    // Each group owns a distinct draft object. A delayed ngModel event
    // from the old form cannot overwrite the newly opened group's fields.
    this.newOptionDrafts[groupId] = {
      name: "",
      priceDeltaBaht: "0.00",
    };
    this.newOptionGroupId.set(groupId);
  }

  groupsFor(productId: string): CatalogModifierGroup[] {
    return this.modifierGroups().filter(
      (group) => group.productId === productId,
    );
  }

  optionsFor(groupId: string): CatalogModifierOption[] {
    return this.modifierOptions().filter(
      (option) => option.groupId === groupId,
    );
  }

  async addGroup(product: CatalogProduct): Promise<void> {
    const values = { ...this.newGroup };
    if (
      !values.name.trim() ||
      !Number.isInteger(values.minSelect) ||
      !Number.isInteger(values.maxSelect) ||
      values.minSelect < 0 ||
      values.maxSelect < 1 ||
      values.maxSelect > 8 ||
      values.minSelect > values.maxSelect
    ) {
      this.error.set("กรุณาระบุชื่อและจำนวนตัวเลือกให้ถูกต้อง");
      return;
    }
    if (
      await this.mutate(
        () =>
          this.api.addModifierGroup(this.tenantId, this.storeId, product.id, {
            ...values,
            name: values.name.trim(),
            slug: values.slug.trim(),
          }),
        "เพิ่มกลุ่มตัวเลือกแล้ว",
      )
    ) {
      this.newGroup = { name: "", slug: "", minSelect: 0, maxSelect: 1 };
    }
  }

  beginGroupEdit(group: CatalogModifierGroup): void {
    this.groupBefore = { ...group };
    this.groupEdit = {
      name: group.name,
      slug: group.slug,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
    };
    this.groupEditId.set(group.id);
  }

  async saveGroupEdit(product: CatalogProduct): Promise<void> {
    const old = this.groupBefore;
    const values = { ...this.groupEdit };
    if (
      !old ||
      !values.name.trim() ||
      !Number.isInteger(values.minSelect) ||
      !Number.isInteger(values.maxSelect) ||
      values.minSelect < 0 ||
      values.maxSelect < 1 ||
      values.maxSelect > 8 ||
      values.minSelect > values.maxSelect
    ) {
      this.error.set("จำนวนตัวเลือกไม่ถูกต้อง");
      return;
    }
    await this.mutate(
      () =>
        this.api.editModifierGroup(
          this.tenantId,
          this.storeId,
          product.id,
          old,
          {
            ...values,
            name: values.name.trim(),
            slug: values.slug.trim(),
          },
        ),
      "บันทึกกลุ่มตัวเลือกแล้ว",
    );
  }

  async addOption(
    product: CatalogProduct,
    group: CatalogModifierGroup,
  ): Promise<void> {
    const draft = this.newOptionDrafts[group.id];
    const delta = draft ? parseDeltaBaht(draft.priceDeltaBaht) : null;
    if (!draft || !draft.name.trim() || delta === null) {
      this.error.set("ชื่อหรือราคาเพิ่ม/ลดของตัวเลือกไม่ถูกต้อง");
      return;
    }
    if (
      await this.mutate(
        () =>
          this.api.addModifierOption(
            this.tenantId,
            this.storeId,
            product.id,
            group.id,
            { name: draft.name.trim(), priceDeltaSatang: delta },
          ),
        "เพิ่มตัวเลือกสินค้าแล้ว",
      )
    ) {
      delete this.newOptionDrafts[group.id];
      this.newOptionGroupId.set(null);
    }
  }

  beginOptionEdit(option: CatalogModifierOption): void {
    this.optionBefore = { ...option };
    this.optionEdit = {
      name: option.name,
      priceDeltaBaht: bahtInput(Math.abs(option.priceDeltaSatang)),
      available: option.available,
    };
    if (option.priceDeltaSatang < 0) {
      this.optionEdit.priceDeltaBaht = "-" + this.optionEdit.priceDeltaBaht;
    }
    this.optionEditId.set(option.id);
  }

  async saveOptionEdit(product: CatalogProduct): Promise<void> {
    const old = this.optionBefore;
    const delta = parseDeltaBaht(this.optionEdit.priceDeltaBaht);
    if (!old || !this.optionEdit.name.trim() || delta === null) {
      this.error.set("ชื่อหรือราคาเพิ่ม/ลดของตัวเลือกไม่ถูกต้อง");
      return;
    }
    await this.mutate(
      () =>
        this.api.editModifierOption(
          this.tenantId,
          this.storeId,
          product.id,
          old,
          {
            name: this.optionEdit.name.trim(),
            priceDeltaSatang: delta,
            available: this.optionEdit.available,
          },
        ),
      "บันทึกตัวเลือกสินค้าแล้ว",
    );
  }
}
