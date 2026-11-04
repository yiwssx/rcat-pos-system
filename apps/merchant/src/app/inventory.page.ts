import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MerchantOrderApi } from "./merchant-order.api";
import { MerchantStore } from "./order-board.domain";
import { InventoryApi } from "./inventory.api";
import {
  CatalogProducts,
  InventoryKind,
  InventorySnapshot,
  InventoryUnit,
  formatUnits,
  lowStock,
  validStockInput,
} from "./inventory.domain";

function inventoryError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return "เซสชันหมดอายุ โปรดเข้าสู่ระบบใหม่";
    if (error.status === 403 || error.status === 404) {
      return "ไม่มีสิทธิ์ดูหรือจัดการสต็อกของร้านนี้";
    }
    if (error.status === 409)
      return "ข้อมูลถูกใช้แล้ว หรือรหัส Retry ถูกใช้กับรายการอื่น";
    if (error.status === 400) return "จำนวนไม่ถูกต้อง หรือสต็อกไม่เพียงพอ";
    if (error.status === 0)
      return "เชื่อมต่อไม่ได้ โปรดลองใหม่โดยไม่แก้ไขรายการ";
  }
  return error instanceof Error ? error.message : "ไม่สามารถดำเนินการได้";
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrls: ["./inventory.css"],
  template: `
    <section class="inventory-shell" aria-labelledby="inventory-heading">
      <a routerLink="/" class="inventory-back">← กลับไปหน้าร้านค้า</a>
      <span class="eyebrow">INVENTORY / EXPLICIT ORDER TRACKING</span>
      <h1 id="inventory-heading">สต็อกวัตถุดิบของร้าน</h1>
      <p class="inventory-muted">
        {{ store()?.storeName || "กำลังตรวจสอบสิทธิ์..." }}
        · ปริมาณใช้หน่วย g / ml / ชิ้น และจำนวนเต็มทศนิยมไม่เกิน 3 ตำแหน่ง
      </p>
      <p class="inventory-warning" role="note">
        <strong>ตัดสต็อกเมื่อร้านรับออเดอร์ เฉพาะสินค้าที่เปิดติดตาม</strong>
        สินค้าทุกชนิดเริ่มในโหมดจัดการสต็อกด้วยตนเอง
        ตรวจสูตรหลักและตัวเลือกเสริมก่อนเปิดติดตามรายสินค้า
        ระบบคืนปริมาณที่ตัดจริงเมื่อยกเลิกออเดอร์ที่รับแล้ว
        สต็อกไม่ใช่ยอดเงินรับหรือข้อมูล Payment
      </p>

      @if (error()) {
        <div class="inventory-error" role="alert">{{ error() }}</div>
      }
      @if (notice()) {
        <p class="inventory-notice" role="status">{{ notice() }}</p>
      }
      @if (loading()) {
        <p class="inventory-muted" role="status">กำลังโหลดสต็อกจาก Server...</p>
      }
      @if (store(); as currentStore) {
        @if (snapshot(); as data) {
          <div class="inventory-toolbar">
            <span
              >วัตถุดิบ {{ data.items.length }} รายการ · บันทึกล่าสุดสูงสุด 50
              รายการ</span
            >
            <button type="button" [disabled]="busy()" (click)="reload()">
              โหลดข้อมูลล่าสุด
            </button>
          </div>

          <section class="inventory-panel" aria-labelledby="stock-list-heading">
            <h2 id="stock-list-heading">ยอดคงเหลือจาก Ledger</h2>
            @if (data.items.length === 0) {
              <p class="inventory-muted">ยังไม่มีวัตถุดิบในร้าน</p>
            } @else {
              <div class="inventory-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">วัตถุดิบ</th>
                      <th scope="col">คงเหลือ</th>
                      <th scope="col">เกณฑ์แจ้งเตือน</th>
                      <th scope="col">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (item of data.items; track item.itemId) {
                      <tr>
                        <th scope="row">{{ item.name }}</th>
                        <td>{{ units(item.onHand) }} {{ item.unit }}</td>
                        <td>{{ units(item.reorderAt) }} {{ item.unit }}</td>
                        <td>
                          @if (isLow(item)) {
                            <strong class="inventory-low"
                              >ต่ำกว่าหรือเท่ากับเกณฑ์</strong
                            >
                          } @else {
                            <span>เพียงพอตามเกณฑ์</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>

          @if (
            currentStore.role === "owner" || currentStore.role === "manager"
          ) {
            <div class="inventory-grid">
              <section
                class="inventory-panel"
                aria-labelledby="add-ingredient-heading"
              >
                <h2 id="add-ingredient-heading">เพิ่มวัตถุดิบ</h2>
                <form
                  class="inventory-form"
                  (submit)="createIngredient($event)"
                >
                  <label
                    >ชื่อวัตถุดิบ
                    <input
                      type="text"
                      [value]="newName()"
                      (input)="setText($event, 'name')"
                      maxlength="120"
                      required
                      placeholder="เช่น ข้าวสาร"
                    />
                  </label>
                  <label
                    >หน่วย
                    <select [value]="newUnit()" (change)="onUnit($event)">
                      <option value="g">กรัม (g)</option>
                      <option value="ml">มิลลิลิตร (ml)</option>
                      <option value="unit">ชิ้น (unit)</option>
                    </select>
                  </label>
                  <label
                    >เกณฑ์แจ้งเตือนขั้นต่ำ
                    <input
                      type="text"
                      inputmode="decimal"
                      [value]="reorderAt()"
                      (input)="setText($event, 'reorder')"
                      required
                    />
                  </label>
                  <button type="submit" [disabled]="busy()">
                    สร้างวัตถุดิบ
                  </button>
                </form>
              </section>

              <section
                class="inventory-panel"
                aria-labelledby="movement-heading"
              >
                <h2 id="movement-heading">บันทึกการเคลื่อนไหว</h2>
                <p class="inventory-muted">
                  รับของเข้าต้องใช้จำนวนบวก หากปรับลด ให้เลือกปรับยอดและใส่ -
                  นำหน้า ระบบจะปฏิเสธรายการที่ทำให้ยอดติดลบ
                </p>
                <form class="inventory-form" (submit)="moveStock($event)">
                  <label
                    >วัตถุดิบ
                    <select
                      [value]="moveItemId()"
                      (change)="onSelect($event, 'movement-item')"
                      required
                    >
                      <option value="">เลือกวัตถุดิบ</option>
                      @for (item of data.items; track item.itemId) {
                        <option [value]="item.itemId">
                          {{ item.name }} ({{ item.unit }})
                        </option>
                      }
                    </select>
                  </label>
                  <label
                    >ประเภท
                    <select [value]="moveKind()" (change)="onMoveKind($event)">
                      <option value="receipt">รับสินค้าเข้า (+)</option>
                      <option value="adjustment">ปรับยอด (+ หรือ -)</option>
                    </select>
                  </label>
                  <label
                    >จำนวน (ไม่เกิน 3 ตำแหน่งทศนิยม)
                    <input
                      type="text"
                      inputmode="decimal"
                      [value]="moveDelta()"
                      (input)="setText($event, 'delta')"
                      required
                      placeholder="50.500"
                    />
                  </label>
                  <label
                    >เหตุผลหรือเอกสารอ้างอิง
                    <input
                      type="text"
                      [value]="moveReason()"
                      (input)="setText($event, 'reason')"
                      maxlength="200"
                      required
                      placeholder="รับของจากผู้ขาย"
                    />
                  </label>
                  <button
                    type="submit"
                    [disabled]="busy() || !data.items.length"
                  >
                    {{ busy() ? "กำลังตรวจสอบ..." : "ยืนยันบันทึกสต็อก" }}
                  </button>
                  <p class="inventory-muted">
                    หากเครือข่ายขัดข้อง กดลองอีกครั้งโดยไม่เปลี่ยนข้อมูล
                    เพื่อส่งรหัส Idempotency เดิม
                  </p>
                </form>
              </section>
            </div>

            <section class="inventory-panel" aria-labelledby="recipe-heading">
              <h2 id="recipe-heading">สูตรการใช้วัตถุดิบต่อสินค้า 1 รายการ</h2>
              <p class="inventory-muted">
                สูตรนี้เป็นข้อมูลวางแผนจนกว่าจะเปิดติดตามสต็อกรายสินค้า
                หลังเปิดแล้วจะตัดวัตถุดิบเมื่อร้านรับออเดอร์ ใส่ 0 เพื่อลบส่วนประกอบ
              </p>
              <form
                class="inventory-form inventory-recipe-form"
                (submit)="setRecipe($event)"
              >
                <label
                  >สินค้า
                  <select
                    [value]="recipeProductId()"
                    (change)="onSelect($event, 'product')"
                    required
                  >
                    <option value="">เลือกสินค้า</option>
                    @for (
                      product of catalog()?.products || [];
                      track product.id
                    ) {
                      <option [value]="product.id">{{ product.name }}</option>
                    }
                  </select>
                </label>
                <label
                  >วัตถุดิบ
                  <select
                    [value]="recipeItemId()"
                    (change)="onSelect($event, 'recipe-item')"
                    required
                  >
                    <option value="">เลือกวัตถุดิบ</option>
                    @for (item of data.items; track item.itemId) {
                      <option [value]="item.itemId">
                        {{ item.name }} ({{ item.unit }})
                      </option>
                    }
                  </select>
                </label>
                <label
                  >ปริมาณที่ใช้ต่อสินค้า 1 ชิ้น
                  <input
                    type="text"
                    inputmode="decimal"
                    [value]="recipeQuantity()"
                    (input)="setText($event, 'recipe')"
                    required
                  />
                </label>
                <button
                  type="submit"
                  [disabled]="
                    busy() || !data.items.length || !catalog()?.products?.length
                  "
                >
                  บันทึกสูตรวัตถุดิบ
                </button>
              </form>
            </section>
          }

          <div class="inventory-grid">
            <section
              class="inventory-panel"
              aria-labelledby="recipe-list-heading"
            >
              <h2 id="recipe-list-heading">สูตรที่บันทึกแล้ว</h2>
              @if (data.recipes.length === 0) {
                <p class="inventory-muted">ยังไม่มีข้อมูลสูตรวัตถุดิบ</p>
              } @else {
                <ul class="inventory-detail-list">
                  @for (
                    recipe of data.recipes;
                    track recipe.productId + recipe.itemId
                  ) {
                    <li>
                      <strong>{{ recipe.productName }}</strong>
                      <span>
                        {{ ingredientName(recipe.itemId) }}
                        {{ units(recipe.quantityPerProduct) }}
                        {{ ingredientUnit(recipe.itemId) }} / สินค้า 1 รายการ
                      </span>
                    </li>
                  }
                </ul>
              }
            </section>
            <section
              class="inventory-panel"
              aria-labelledby="movement-list-heading"
            >
              <h2 id="movement-list-heading">ประวัติการเคลื่อนไหวล่าสุด</h2>
              @if (data.recentMovements.length === 0) {
                <p class="inventory-muted">ยังไม่มีการบันทึกการเคลื่อนไหว</p>
              } @else {
                <ul class="inventory-detail-list">
                  @for (
                    movement of data.recentMovements;
                    track movement.movementId
                  ) {
                    <li>
                      <strong>{{ ingredientName(movement.itemId) }}</strong>
                      <span
                        >{{
                          movementLabel(movement.kind)
                        }}
                        {{ units(movement.delta) }}
                        {{ ingredientUnit(movement.itemId) }}
                        · คงเหลือ {{ units(movement.quantityAfter) }}
                      </span>
                      <small>{{ movement.reason }}</small>
                    </li>
                  }
                </ul>
              }
            </section>
          </div>
        }
      }
    </section>
  `,
})
export class InventoryPage implements OnInit {
  private readonly api = inject(InventoryApi);
  private readonly merchant = inject(MerchantOrderApi);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  private readonly tenantId =
    this.route.snapshot.paramMap.get("tenantId") ?? "";
  private readonly storeId = this.route.snapshot.paramMap.get("storeId") ?? "";
  readonly store = signal<MerchantStore | null>(null);
  readonly snapshot = signal<InventorySnapshot | null>(null);
  readonly catalog = signal<CatalogProducts | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly newName = signal("");
  readonly newUnit = signal<InventoryUnit>("g");
  readonly reorderAt = signal("0");
  readonly moveItemId = signal("");
  readonly moveKind = signal<InventoryKind>("receipt");
  readonly moveDelta = signal("");
  readonly moveReason = signal("");
  readonly recipeProductId = signal("");
  readonly recipeItemId = signal("");
  readonly recipeQuantity = signal("");
  readonly modifierOptionId = signal("");
  readonly modifierItemId = signal("");
  readonly modifierQuantity = signal("");
  readonly units = formatUnits;
  readonly isLow = lowStock;
  private retry: { payload: string; key: string } | null = null;

  ngOnInit(): void {
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const { stores } = await this.merchant.stores();
      const store = stores.find(
        (entry) =>
          entry.tenantId === this.tenantId &&
          entry.storeId === this.storeId &&
          entry.role !== "cashier",
      );
      if (!store) throw new Error("ไม่มีสิทธิ์เข้าถึงสต็อกของร้านนี้");
      this.store.set(store);
      await this.reload();
    } catch (error) {
      this.error.set(inventoryError(error));
    } finally {
      this.loading.set(false);
    }
  }

  async reload(): Promise<void> {
    if (!this.store()) return;
    this.loading.set(true);
    this.error.set("");
    try {
      const snapshot = await this.api.snapshot(this.tenantId, this.storeId);
      if (
        !["manual_ledger_only", "order_acceptance_opt_in"].includes(snapshot.stockMode) ||
        typeof snapshot.orderConsumptionEnabled !== "boolean"
      ) {
        throw new Error("ข้อมูลสต็อกไม่อยู่ในรูปแบบ Ledger ที่รองรับ");
      }
      this.snapshot.set(snapshot);
      if (this.store()?.role === "owner" || this.store()?.role === "manager") {
        this.catalog.set(await this.api.catalog(this.tenantId, this.storeId));
      }
    } catch (error) {
      this.error.set(inventoryError(error));
    } finally {
      this.loading.set(false);
    }
  }

  isTracked(productId: string): boolean {
    return (this.snapshot()?.trackedProducts || []).some(
      (product) => product.productId === productId,
    );
  }
  productName(productId: string): string {
    return this.catalog()?.products.find((product) => product.id === productId)?.name
      ?? "สินค้า";
  }
  modifierName(optionId: string): string {
    return this.catalog()?.modifierOptions.find((option) => option.id === optionId)?.name
      ?? "ตัวเลือกเสริม";
  }
  movementLabel(kind: InventoryKind): string {
    if (kind === "receipt") return "รับเข้า";
    if (kind === "adjustment") return "ปรับยอด";
    if (kind === "order_consumption") return "ตัดตามออเดอร์";
    return "คืนจากการยกเลิกออเดอร์";
  }

  async toggleTracking(productId: string, tracked: boolean): Promise<void> {
    if (!this.canWrite() ||
      !this.catalog()?.products.some((product) => product.id === productId)) return;
    if (tracked && !this.snapshot()?.recipes.some(
      (recipe) => recipe.productId === productId,
    )) {
      this.error.set("ต้องบันทึกสูตรวัตถุดิบหลักก่อนเปิดตัดสต็อก");
      return;
    }
    const confirmed = this.document.defaultView?.confirm(
      tracked
        ? "ยืนยันเปิดตัดสต็อกเมนูนี้เมื่อร้านรับออเดอร์? ตรวจสูตรหลักและ Modifier แล้ว"
        : "ยืนยันปิดการตัดสต็อกสำหรับออเดอร์ใหม่ของเมนูนี้?",
    );
    if (!confirmed) return;
    this.busy.set(true);
    this.error.set("");
    try {
      await this.api.tracking(this.tenantId, this.storeId, productId, tracked);
      this.notice.set(tracked
        ? "เปิดตัดสต็อกตามออเดอร์ให้สินค้านี้แล้ว"
        : "ปิดตัดสต็อกให้สินค้านี้สำหรับออเดอร์ใหม่แล้ว");
      await this.reload();
    } catch (error) {
      this.error.set(inventoryError(error));
    } finally {
      this.busy.set(false);
    }
  }

  async updateModifierRecipe(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canWrite()) return;
    const option = this.catalog()?.modifierOptions.find(
      (entry) => entry.id === this.modifierOptionId(),
    );
    if (!option ||
      !this.snapshot()?.items.some((item) => item.itemId === this.modifierItemId()) ||
      !validStockInput(this.modifierQuantity(), { zero: true, max: 1000000000n })) {
      this.error.set("กรุณาเลือกตัวเลือกเสริม วัตถุดิบ และปริมาณที่ถูกต้อง");
      return;
    }
    this.busy.set(true);
    this.error.set("");
    try {
      await this.api.modifierRecipe(this.tenantId, this.storeId,
        option.productId, option.groupId, option.id,
        this.modifierItemId(), this.modifierQuantity());
      this.notice.set("บันทึกปริมาณ Modifier แล้ว (มีผลเมื่อรับออเดอร์ใหม่)");
      await this.reload();
    } catch (error) {
      this.error.set(inventoryError(error));
    } finally {
      this.busy.set(false);
    }
  }

  ingredientName(id: string): string {
    return (
      this.snapshot()?.items.find((item) => item.itemId === id)?.name ??
      "วัตถุดิบ"
    );
  }
  ingredientUnit(id: string): string {
    return (
      this.snapshot()?.items.find((item) => item.itemId === id)?.unit ?? ""
    );
  }

  setText(event: Event, field: string): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const value = event.target.value;
    if (field === "name") this.newName.set(value);
    if (field === "reorder") this.reorderAt.set(value);
    if (field === "delta") this.moveDelta.set(value);
    if (field === "reason") this.moveReason.set(value);
    if (field === "recipe") this.recipeQuantity.set(value);
    if (field === "modifier") this.modifierQuantity.set(value);
  }
  onUnit(event: Event): void {
    if (
      event.target instanceof HTMLSelectElement &&
      ["g", "ml", "unit"].includes(event.target.value)
    ) {
      this.newUnit.set(event.target.value as InventoryUnit);
    }
  }
  onMoveKind(event: Event): void {
    if (
      event.target instanceof HTMLSelectElement &&
      (event.target.value === "receipt" || event.target.value === "adjustment")
    ) {
      this.moveKind.set(event.target.value);
    }
  }
  onSelect(event: Event, target: string): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    if (target === "movement-item") this.moveItemId.set(event.target.value);
    if (target === "product") this.recipeProductId.set(event.target.value);
    if (target === "recipe-item") this.recipeItemId.set(event.target.value);
    if (target === "modifier-option") this.modifierOptionId.set(event.target.value);
    if (target === "modifier-item") this.modifierItemId.set(event.target.value);
  }

  private canWrite(): boolean {
    return (
      !this.busy() &&
      (this.store()?.role === "owner" || this.store()?.role === "manager")
    );
  }

  async createIngredient(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canWrite()) return;
    if (
      !this.newName().trim() ||
      this.newName().trim().length > 120 ||
      !validStockInput(this.reorderAt(), { max: 1000000000000n, zero: true })
    ) {
      this.error.set("ชื่อวัตถุดิบหรือเกณฑ์แจ้งเตือนไม่ถูกต้อง");
      return;
    }
    this.busy.set(true);
    this.error.set("");
    try {
      await this.api.createItem(
        this.tenantId,
        this.storeId,
        this.newName().trim(),
        this.newUnit(),
        this.reorderAt(),
      );
      this.newName.set("");
      this.notice.set("สร้างวัตถุดิบสำเร็จ");
      await this.reload();
    } catch (error) {
      this.error.set(inventoryError(error));
    } finally {
      this.busy.set(false);
    }
  }

  async moveStock(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canWrite()) return;
    const delta = this.moveDelta();
    const reason = this.moveReason().trim();
    if (
      !this.snapshot()?.items.some((i) => i.itemId === this.moveItemId()) ||
      !validStockInput(delta, {
        negative: this.moveKind() === "adjustment",
        zero: false,
        max: 1000000000n,
      }) ||
      reason.length < 3 ||
      reason.length > 200
    ) {
      this.error.set("กรุณาตรวจสอบวัตถุดิบ จำนวน และเหตุผล (3–200 อักขระ)");
      return;
    }
    const payload = JSON.stringify({
      itemId: this.moveItemId(),
      kind: this.moveKind(),
      delta,
      reason,
    });
    try {
      const win = this.document.defaultView;
      if (!win?.crypto?.randomUUID)
        throw new Error("Browser ไม่รองรับการสร้างรหัส Retry ที่ปลอดภัย");
      if (!this.retry || this.retry.payload !== payload) {
        this.retry = { payload, key: win.crypto.randomUUID() };
      }
      this.busy.set(true);
      this.error.set("");
      const result = await this.api.move(
        this.tenantId,
        this.storeId,
        this.moveItemId(),
        this.retry.key,
        this.moveKind(),
        delta,
        reason,
      );
      this.retry = null;
      this.moveDelta.set("");
      this.moveReason.set("");
      this.notice.set(
        result.replayed
          ? "ตรวจสอบแล้วว่าเคยบันทึกรายการนี้สำเร็จ"
          : "บันทึกการเคลื่อนไหวสต็อกสำเร็จ",
      );
      await this.reload();
    } catch (error) {
      this.error.set(inventoryError(error));
    } finally {
      this.busy.set(false);
    }
  }

  async setRecipe(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canWrite()) return;
    if (
      !this.catalog()?.products.some((p) => p.id === this.recipeProductId()) ||
      !this.snapshot()?.items.some((i) => i.itemId === this.recipeItemId()) ||
      !validStockInput(this.recipeQuantity(), { zero: true, max: 1000000000n })
    ) {
      this.error.set("กรุณาเลือกสินค้า วัตถุดิบ และระบุจำนวนที่ถูกต้อง");
      return;
    }
    this.busy.set(true);
    this.error.set("");
    try {
      await this.api.recipe(
        this.tenantId,
        this.storeId,
        this.recipeProductId(),
        this.recipeItemId(),
        this.recipeQuantity(),
      );
      this.notice.set("บันทึกสูตรวัตถุดิบสำเร็จ");
      await this.reload();
    } catch (error) {
      this.error.set(inventoryError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
