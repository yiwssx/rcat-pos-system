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
import { prepareProductWebp } from "./prepare-product-webp";
import { MerchantOrderApi } from "./merchant-order.api";
import {
  CATALOG_PAGE_SIZE,
  filterCatalogProducts,
  paginateCatalogProducts,
  catalogPageCount,
} from "./catalog-list";
import {
  CatalogCategory,
  CatalogProduct,
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
  imports: [RouterLink, FormsModule],
  styleUrls: ["./merchant-catalog.css"],
  template: `
    <section class="catalog-shell" aria-labelledby="catalog-title">
      <header class="catalog-head">
        <a routerLink="/" class="catalog-back">← ร้านค้าของฉัน</a>
        <p class="eyebrow">MERCHANT / MENU MANAGEMENT</p>
        <h1 id="catalog-title">จัดการเมนูและสินค้า</h1>
        <p class="catalog-intro">
          ปรับราคา ชื่อ หมวดหมู่ และสถานะการขาย
          โดยไม่เปลี่ยนราคาที่บันทึกในออเดอร์เก่า
        </p>
        <p class="catalog-notice">
          การเก็บสินค้าเข้าคลัง (Archive) จะนำออกจากเมนูลูกค้าถาวร
          แต่ยังคงประวัติออเดอร์และสต็อก ไม่มีการรับชำระเงินจากหน้านี้
        </p>
      </header>

      @if (loading()) {
        <p role="status" class="catalog-message">
          กำลังตรวจสอบสิทธิ์และโหลดสินค้า...
        </p>
      } @else if (!canManage()) {
        <p class="catalog-message" role="alert">
          {{ error() || "เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่แก้ไขเมนูได้" }}
        </p>
      } @else {
        @if (error()) {
          <p class="catalog-message catalog-error" role="alert">
            {{ error() }}
          </p>
        }
        @if (success()) {
          <p class="catalog-message catalog-success" role="status">
            {{ success() }}
          </p>
        }

        <div class="catalog-grid">
          <form class="catalog-panel" (ngSubmit)="addCategory()">
            <h2>เพิ่มหมวดหมู่</h2>
            <label for="category-name">ชื่อหมวดหมู่</label>
            <input
              id="category-name"
              name="categoryName"
              [(ngModel)]="newCategory.name"
              maxlength="120"
              required
              placeholder="เช่น อาหารจานเดียว"
              [disabled]="saving()"
            />
            <label for="category-slug">รหัสหมวดหมู่ (ภาษาอังกฤษ)</label>
            <input
              id="category-slug"
              name="categorySlug"
              [(ngModel)]="newCategory.slug"
              maxlength="48"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="thai-food"
              [disabled]="saving()"
            />
            <button type="submit" [disabled]="saving()">เพิ่มหมวดหมู่</button>
          </form>

          <form class="catalog-panel" (ngSubmit)="addProduct()">
            <h2>เพิ่มสินค้า</h2>
            <label for="new-product-name">ชื่อสินค้า</label>
            <input
              id="new-product-name"
              name="newProductName"
              [(ngModel)]="newProduct.name"
              maxlength="160"
              required
              placeholder="เช่น ข้าวผัด"
              [disabled]="saving()"
            />
            <label for="new-product-category">หมวดหมู่</label>
            <select
              id="new-product-category"
              name="newProductCategory"
              [(ngModel)]="newProduct.categoryId"
              required
              [disabled]="saving()"
            >
              <option value="" disabled>เลือกหมวดหมู่</option>
              @for (category of categories(); track category.id) {
                <option [value]="category.id">{{ category.name }}</option>
              }
            </select>
            <label for="new-product-price">ราคาขาย (บาท)</label>
            <input
              id="new-product-price"
              name="newProductPrice"
              [(ngModel)]="newProduct.priceBaht"
              required
              inputmode="decimal"
              placeholder="59.00"
              [disabled]="saving()"
            />
            <button
              type="submit"
              [disabled]="saving() || categories().length === 0"
            >
              เพิ่มสินค้า
            </button>
          </form>
        </div>

        <section
          class="catalog-panel catalog-products"
          aria-labelledby="products-title"
        >
          <div class="catalog-toolbar">
            <div>
              <h2 id="products-title">สินค้าทั้งหมด</h2>
              <p>สินค้า {{ products().length }} รายการ · ราคาที่แสดงเป็นบาท</p>
            </div>
            <div class="catalog-actions">
              <button type="button" class="subtle" (click)="toggleArchived()">
                {{
                  showArchived() ? "ซ่อนสินค้าเก็บถาวร" : "แสดงสินค้าเก็บถาวร"
                }}
              </button>
              <button
                type="button"
                class="subtle"
                (click)="refresh()"
                [disabled]="saving()"
              >
                โหลดข้อมูลใหม่
              </button>
            </div>
          </div>
          <div class="catalog-filters">
            <div>
              <label for="catalog-search">ค้นหาชื่อสินค้า</label>
              <input
                id="catalog-search"
                name="catalogSearch"
                [(ngModel)]="search"
                (ngModelChange)="resetPage()"
                placeholder="พิมพ์ชื่อสินค้า..."
                autocomplete="off"
              />
            </div>
            <div>
              <label for="catalog-category-filter">กรองตามหมวดหมู่</label>
              <select
                id="catalog-category-filter"
                name="catalogCategoryFilter"
                [(ngModel)]="categoryFilter"
                (ngModelChange)="resetPage()"
              >
                <option value="">ทุกหมวดหมู่</option>
                @for (category of categories(); track category.id) {
                  <option [value]="category.id">{{ category.name }}</option>
                }
              </select>
            </div>
          </div>
          <p class="catalog-page-status" role="status" aria-live="polite">
            พบ {{ filteredProducts().length }} รายการ · หน้า {{ page() }} จาก
            {{ pageCount() }} (หน้าละ {{ pageSize }} รายการ)
          </p>

          @for (product of displayedProducts(); track product.id) {
            <article class="catalog-product">
              <div class="catalog-summary">
                <div>
                  <h3>{{ product.name }}</h3>
                  <p>
                    {{ categoryName(product.categoryId) }} ·
                    {{ money(product.priceSatang) }} บาท
                  </p>
                  <span
                    class="catalog-status"
                    [class.inactive]="!product.available"
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
                @if (!product.archivedAt) {
                  <div class="catalog-actions">
                    <button
                      type="button"
                      class="subtle"
                      [disabled]="saving()"
                      (click)="beginEdit(product)"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      class="subtle"
                      [disabled]="saving()"
                      (click)="toggleAvailability(product)"
                    >
                      {{ product.available ? "ปิดขาย" : "เปิดขาย" }}
                    </button>
                    <button
                      type="button"
                      class="danger"
                      [disabled]="saving()"
                      (click)="archive(product)"
                    >
                      เก็บถาวร
                    </button>
                  </div>
                }
              </div>
              <div class="catalog-media" aria-label="รูปภาพสินค้า">
                @if (product.hasImage) {
                  <img
                    [src]="imageUrl(product)"
                    [alt]="'รูปสินค้า ' + product.name"
                    class="catalog-media-preview"
                    loading="lazy"
                  />
                }
                @if (!product.archivedAt) {
                  <div class="catalog-media-actions">
                    <label [attr.for]="'catalog-media-' + product.id">
                      {{
                        product.hasImage ? "เปลี่ยนรูปสินค้า" : "เพิ่มรูปสินค้า"
                      }}
                    </label>
                    <input
                      [id]="'catalog-media-' + product.id"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      [disabled]="saving()"
                      (change)="uploadImage($event, product)"
                    />
                    @if (product.hasImage) {
                      <button
                        type="button"
                        class="subtle"
                        [disabled]="saving()"
                        (click)="removeImage(product)"
                      >
                        ลบรูปสินค้า
                      </button>
                    }
                  </div>
                  <p>
                    JPG / PNG / WebP · แปลงเป็น WebP ก่อนส่ง · สูงสุด 192 KB
                  </p>
                }
              </div>
              @if (editId() === product.id && !product.archivedAt) {
                <form class="catalog-edit" (ngSubmit)="saveEdit()">
                  <p>
                    แก้ไขข้อมูลสินค้า · ตรวจสอบ Revision {{ edit.revision }}
                  </p>
                  <label for="edit-product-name">ชื่อสินค้า</label>
                  <input
                    id="edit-product-name"
                    name="editName"
                    [(ngModel)]="edit.name"
                    required
                    maxlength="160"
                    [disabled]="saving()"
                  />
                  <label for="edit-product-category">หมวดหมู่</label>
                  <select
                    id="edit-product-category"
                    name="editCategory"
                    [(ngModel)]="edit.categoryId"
                    required
                    [disabled]="saving()"
                  >
                    @for (category of categories(); track category.id) {
                      <option [value]="category.id">{{ category.name }}</option>
                    }
                  </select>
                  <label for="edit-product-price">ราคาขายใหม่ (บาท)</label>
                  <input
                    id="edit-product-price"
                    name="editPrice"
                    [(ngModel)]="edit.priceBaht"
                    required
                    inputmode="decimal"
                    [disabled]="saving()"
                  />
                  <div class="catalog-actions">
                    <button type="submit" [disabled]="saving()">
                      บันทึกการแก้ไข
                    </button>
                    <button
                      type="button"
                      class="subtle"
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
            <p class="catalog-empty" role="status">
              ไม่พบสินค้าที่ตรงกับเงื่อนไข
            </p>
          }
          @if (filteredProducts().length > pageSize) {
            <nav class="catalog-pagination" aria-label="แบ่งหน้ารายการสินค้า">
              <button
                type="button"
                class="subtle"
                [disabled]="saving() || page() <= 1"
                (click)="previousPage()"
              >
                ← ก่อนหน้า
              </button>
              <span aria-live="polite">หน้า {{ page() }} / {{ pageCount() }}</span>
              <button
                type="button"
                class="subtle"
                [disabled]="saving() || page() >= pageCount()"
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
  readonly page = signal(1);
  readonly pageSize = CATALOG_PAGE_SIZE;

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
    try {
      const snapshot = await this.api.snapshot(this.tenantId, this.storeId);
      this.categories.set(snapshot.categories);
      this.products.set(snapshot.products);
      if (
        this.categoryFilter &&
        !snapshot.categories.some((c) => c.id === this.categoryFilter)
      ) {
        this.categoryFilter = "";
      }
      this.page.update((current) => Math.min(current, this.pageCount()));
      if (
        !snapshot.categories.some((c) => c.id === this.newProduct.categoryId)
      ) {
        this.newProduct.categoryId = snapshot.categories[0]?.id ?? "";
      }
      this.editId.set(null);
    } catch {
      this.error.set("ไม่สามารถโหลดข้อมูลเมนูล่าสุดได้");
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

  filteredProducts(): CatalogProduct[] {
    return filterCatalogProducts(this.products(), {
      search: this.search,
      categoryId: this.categoryFilter,
      includeArchived: this.showArchived(),
    });
  }

  displayedProducts(): CatalogProduct[] {
    return paginateCatalogProducts(
      this.filteredProducts(),
      this.page(),
      this.pageSize,
    );
  }

  pageCount(): number {
    return catalogPageCount(this.filteredProducts().length, this.pageSize);
  }

  resetPage(): void {
    this.page.set(1);
    this.editId.set(null);
  }

  previousPage(): void {
    this.page.update((current) => Math.max(1, current - 1));
    this.editId.set(null);
  }

  nextPage(): void {
    this.page.update((current) => Math.min(this.pageCount(), current + 1));
    this.editId.set(null);
  }

  toggleArchived(): void {
    this.showArchived.update((value) => !value);
    this.resetPage();
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
          ? "ข้อมูลสินค้านี้มีการเปลี่ยนแปลง กรุณาโหลดใหม่แล้วตรวจสอบก่อนบันทึก"
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
}
