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
import { CATALOG_PAGE_SIZE } from "./catalog-list";
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

function parseDeltaBaht(value: string): number | null {
  const match = /^(-?)(0|[1-9]\\d{0,6})(?:\\.(\\d{1,2}))?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const amount = Number(match[2]) * 100 +
    Number((match[3] ?? "").padEnd(2, "0"));
  return amount <= 100000000 ? (match[1] ? -amount : amount) : null;
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
              <p>
                แสดง {{ products().length }} รายการในหน้านี้ ·
                ราคาที่แสดงเป็นบาท
              </p>
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
                [(ngModel)]="searchDraft"
                (keyup.enter)="applyFilters()"
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
                (ngModelChange)="applyFilters()"
              >
                <option value="">ทุกหมวดหมู่</option>
                @for (category of categories(); track category.id) {
                  <option [value]="category.id">{{ category.name }}</option>
                }
              </select>
            </div>
          </div>
          <div class="catalog-actions">
            <button
              type="button"
              class="subtle"
              (click)="applyFilters()"
              [disabled]="pageLoading() || saving()"
            >
              ค้นหาสินค้า
            </button>
          </div>
          <p class="catalog-page-status" role="status" aria-live="polite">
            หน้า {{ page() }} · สูงสุด {{ pageSize }} รายการต่อหน้า
            @if (pageLoading()) {
              · กำลังโหลด...
            }
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
          @if (page() > 1 || hasMore()) {
            <nav class="catalog-pagination" aria-label="แบ่งหน้ารายการสินค้า">
              <button
                type="button"
                class="subtle"
                [disabled]="saving() || pageLoading() || page() <= 1"
                (click)="previousPage()"
              >
                ← ก่อนหน้า
              </button>
              <span aria-live="polite">หน้า {{ page() }}</span>
              <button
                type="button"
                class="subtle"
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
  readonly page = signal(1);
  readonly pageSize = CATALOG_PAGE_SIZE;
  readonly categoryEditId = signal<string | null>(null);
  readonly modifierProductId = signal<string | null>(null);
  readonly groupEditId = signal<string | null>(null);
  readonly optionEditId = signal<string | null>(null);
  readonly modifierGroups = signal<CatalogModifierGroup[]>([]);
  readonly modifierOptions = signal<CatalogModifierOption[]>([]);
  private categoryBefore: CatalogCategory | null = null;
  private groupBefore: CatalogModifierGroup | null = null;
  private optionBefore: CatalogModifierOption | null = null;
  categoryEdit = { name: "", slug: "" };
  newGroup = { name: "", slug: "", minSelect: 0, maxSelect: 1 };
  groupEdit = { name: "", slug: "", minSelect: 0, maxSelect: 1 };
  newOption = { name: "", priceDeltaBaht: "0.00" };
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
      () => this.api.updateCategory(
        this.tenantId, this.storeId, previous.id, previous,
        {
          name: this.categoryEdit.name.trim(),
          slug: this.categoryEdit.slug.trim(),
        },
      ),
      "บันทึกหมวดหมู่แล้ว",
    );
  }

  toggleModifierEditor(product: CatalogProduct): void {
    this.modifierProductId.update((id) => id === product.id ? null : product.id);
    this.groupEditId.set(null);
    this.optionEditId.set(null);
  }

  groupsFor(productId: string): CatalogModifierGroup[] {
    return this.modifierGroups().filter((group) => group.productId === productId);
  }

  optionsFor(groupId: string): CatalogModifierOption[] {
    return this.modifierOptions().filter((option) => option.groupId === groupId);
  }

  async addGroup(product: CatalogProduct): Promise<void> {
    const values = { ...this.newGroup };
    if (
      !values.name.trim() ||
      !Number.isInteger(values.minSelect) ||
      !Number.isInteger(values.maxSelect) ||
      values.minSelect < 0 || values.maxSelect < 1 ||
      values.maxSelect > 8 || values.minSelect > values.maxSelect
    ) {
      this.error.set("กรุณาระบุชื่อและจำนวนตัวเลือกให้ถูกต้อง");
      return;
    }
    if (await this.mutate(
      () => this.api.addModifierGroup(this.tenantId, this.storeId, product.id, {
        ...values, name: values.name.trim(), slug: values.slug.trim(),
      }),
      "เพิ่มกลุ่มตัวเลือกแล้ว",
    )) {
      this.newGroup = { name: "", slug: "", minSelect: 0, maxSelect: 1 };
    }
  }

  beginGroupEdit(group: CatalogModifierGroup): void {
    this.groupBefore = { ...group };
    this.groupEdit = {
      name: group.name, slug: group.slug,
      minSelect: group.minSelect, maxSelect: group.maxSelect,
    };
    this.groupEditId.set(group.id);
  }

  async saveGroupEdit(product: CatalogProduct): Promise<void> {
    const old = this.groupBefore;
    const values = { ...this.groupEdit };
    if (!old || !values.name.trim() ||
      !Number.isInteger(values.minSelect) ||
      !Number.isInteger(values.maxSelect) ||
      values.minSelect < 0 || values.maxSelect < 1 ||
      values.maxSelect > 8 || values.minSelect > values.maxSelect) {
      this.error.set("จำนวนตัวเลือกไม่ถูกต้อง");
      return;
    }
    await this.mutate(
      () => this.api.editModifierGroup(this.tenantId, this.storeId,
        product.id, old, {
          ...values, name: values.name.trim(), slug: values.slug.trim(),
        }),
      "บันทึกกลุ่มตัวเลือกแล้ว",
    );
  }

  async addOption(product: CatalogProduct, group: CatalogModifierGroup): Promise<void> {
    const delta = parseDeltaBaht(this.newOption.priceDeltaBaht);
    if (!this.newOption.name.trim() || delta === null) {
      this.error.set("ชื่อหรือราคาเพิ่ม/ลดของตัวเลือกไม่ถูกต้อง");
      return;
    }
    if (await this.mutate(
      () => this.api.addModifierOption(
        this.tenantId, this.storeId, product.id, group.id,
        { name: this.newOption.name.trim(), priceDeltaSatang: delta },
      ),
      "เพิ่มตัวเลือกสินค้าแล้ว",
    )) {
      this.newOption = { name: "", priceDeltaBaht: "0.00" };
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
      () => this.api.editModifierOption(this.tenantId, this.storeId,
        product.id, old, {
          name: this.optionEdit.name.trim(),
          priceDeltaSatang: delta,
          available: this.optionEdit.available,
        }),
      "บันทึกตัวเลือกสินค้าแล้ว",
    );
  }

}
