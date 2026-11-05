import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import {
  addToCart,
  changeCartQuantity,
  estimateSatang,
  formatSatang,
  GuestModifierGroup,
  GuestModifierOption,
  GuestProduct,
  sanitizedVisitToken,
  selectedOptionError,
} from "./guest-order.domain";
import { GuestOrderApi, GuestOrderSession } from "./guest-order.api";

function guestError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return "เชื่อมต่อไม่ได้ โปรดตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
    if (error.status === 404)
      return "QR ของโต๊ะหมดอายุหรือถูกเปลี่ยนแล้ว โปรดขอ QR ล่าสุดจากร้าน";
    if (error.status === 409)
      return "คำสั่งซื้อถูกเปลี่ยนระหว่างส่ง โปรดตรวจสอบตะกร้าก่อนลองอีกครั้ง";
    if (error.status === 400)
      return "สินค้า/ตัวเลือกไม่ตรงกับเมนูล่าสุด กรุณาตรวจสอบรายการ";
    if (error.status >= 500)
      return "เซิร์ฟเวอร์ไม่พร้อม โปรดลองใหม่โดยไม่เปลี่ยนตะกร้า";
  }
  return error instanceof Error ? error.message : "ไม่สามารถดำเนินการได้";
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrls: ["./guest-order.css"],
  template: `
    <section class="guest-shell" aria-labelledby="guest-title">
      <header class="guest-header">
        <div>
          <span class="eyebrow">RCAT POS · ORDERING QR</span>
          <h1 id="guest-title">
            {{ session.visit()?.storeName || "สั่งอาหารผ่าน QR" }}
          </h1>
          <p class="guest-context">
            @if (session.visit()) {
              <strong>โต๊ะ {{ session.visit()!.tableLabel }}</strong>
              <span>· กรุณาตรวจสอบโต๊ะก่อนสั่ง</span>
            } @else {
              สแกน QR สำหรับสั่งอาหารของร้าน (ไม่ใช่ QR ชำระเงิน)
            }
          </p>
        </div>
        <a class="guest-track-link" routerLink="/order/track">ติดตามออเดอร์</a>
      </header>

      <p class="guest-payment-alert" role="note">
        ระบบนี้รับคำสั่งซื้อเท่านั้น ยังไม่มีการชำระเงินผ่าน PromptPay
        ราคาในตะกร้าเป็นประมาณการ และจะยืนยันยอดจริงหลังส่งออเดอร์
      </p>

      @if (staticTable(); as table) {
        @if (!session.visit()) {
          <form class="guest-code-form" (submit)="submitTableCode($event)">
            <h2>กรอกรหัสรอบโต๊ะ</h2>
            <p>
              QR ติดโต๊ะเป็นลิงก์สาธารณะ ยังสั่งอาหารไม่ได้
              กรุณาขอรหัส 8 หลักจากพนักงานของร้านก่อน
            </p>
            <label for="table-code">รหัส 8 หลักที่พนักงานแจ้ง</label>
            <input
              id="table-code"
              name="tableCode"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="8"
              minlength="8"
              pattern="[0-9]{8}"
              required
              [value]="tableCode()"
              (input)="updateTableCode($event)"
              [disabled]="busy()"
            />
            <button type="submit" [disabled]="busy() || !online() || tableCode().length !== 8">
              {{ busy() ? "กำลังตรวจรหัส..." : "ยืนยันรหัสและเปิดเมนู" }}
            </button>
            <p class="guest-code-help">รหัสจะไม่ถูกส่งใน URL หรือ QR และไม่ได้ใช้ยืนยันการชำระเงิน</p>
          </form>
        }
      }

      @if (loading()) {
        <div class="guest-status" role="status">กำลังอ่านเมนูของร้าน...</div>
      } @else if (error()) {
        <div class="guest-error" role="alert">
          <p>{{ error() }}</p>
          <button type="button" (click)="reload()" [disabled]="loading()">
            ลองอีกครั้ง
          </button>
        </div>
      }

      @if (session.visit(); as visit) {
        <div class="guest-menu-toolbar">
          <label class="guest-search">
            <span>ค้นหาเมนู</span>
            <input
              type="search"
              autocomplete="off"
              placeholder="ชื่ออาหาร / เครื่องดื่ม"
              [value]="search()"
              (input)="onSearch($event)"
            />
          </label>
          <label class="guest-category">
            <span>หมวดหมู่</span>
            <select [value]="category()" (change)="onCategory($event)">
              <option value="">ทุกหมวดหมู่</option>
              @for (group of visit.categories; track group.id) {
                <option [value]="group.id">{{ group.name }}</option>
              }
            </select>
          </label>
        </div>

        @if (products().length === 0) {
          <div class="guest-status" role="status">
            ไม่มีสินค้าในหมวดหมู่นี้หรือไม่พบเมนูที่ค้นหา
          </div>
        } @else {
          <div class="guest-products">
            @for (product of products(); track product.id) {
              <article class="guest-product" [attr.aria-label]="product.name">
                <div class="guest-product-head">
                  <div>
                    <span class="guest-product-category">{{
                      categoryName(product.categoryId)
                    }}</span>
                    <h2>{{ product.name }}</h2>
                  </div>
                  <strong class="guest-price"
                    >{{ money(product.priceSatang) }} ฿</strong
                  >
                </div>
                @for (group of groups(product.id); track group.id) {
                  <fieldset class="guest-options">
                    <legend>
                      {{ group.name }}
                      <span
                        >เลือก {{ group.minSelect }}–{{ group.maxSelect }}</span
                      >
                    </legend>
                    @if (options(group.id).length < group.minSelect) {
                      <p class="guest-warning">
                        ตัวเลือกไม่เพียงพอสำหรับเมนูนี้ กรุณาแจ้งร้านค้า
                      </p>
                    }
                    @for (choice of options(group.id); track choice.id) {
                      <label class="guest-option">
                        <input
                          type="checkbox"
                          [checked]="isSelected(product.id, choice.id)"
                          [disabled]="
                            busy() ||
                            optionDisabled(product.id, group, choice.id)
                          "
                          (change)="toggleOption(product.id, group, choice.id)"
                        />
                        <span>{{ choice.name }}</span>
                        <span class="guest-option-price">
                          {{ choice.priceDeltaSatang > 0 ? "+" : ""
                          }}{{ moneySigned(choice.priceDeltaSatang) }} ฿
                        </span>
                      </label>
                    }
                  </fieldset>
                }
                <div class="guest-product-actions">
                  <button
                    type="button"
                    class="guest-add"
                    [disabled]="busy()"
                    (click)="add(product)"
                  >
                    เพิ่มลงตะกร้า
                  </button>
                </div>
              </article>
            }
          </div>
        }

        <section class="guest-cart" aria-labelledby="cart-title">
          <div class="guest-cart-heading">
            <h2 id="cart-title">ตะกร้าของฉัน</h2>
            <span>{{ cartQty() }} ชิ้น</span>
          </div>
          @if (session.cart().length === 0) {
            <p class="guest-cart-empty">
              ยังไม่มีสินค้าในตะกร้า เลือกรายการจากเมนูด้านบนได้เลย
            </p>
          } @else {
            <ol class="guest-cart-lines">
              @for (line of session.cart(); track $index; let i = $index) {
                <li>
                  <div class="guest-cart-name">
                    <strong>{{ productName(line.productId) }}</strong>
                    <span>{{ selectionNames(line.optionIds) }}</span>
                  </div>
                  <div class="guest-qty">
                    <button
                      type="button"
                      [disabled]="busy()"
                      [attr.aria-label]="
                        'ลดจำนวน ' + productName(line.productId)
                      "
                      (click)="changeQuantity(i, -1)"
                    >
                      −
                    </button>
                    <span>{{ line.quantity }}</span>
                    <button
                      type="button"
                      [disabled]="busy()"
                      [attr.aria-label]="
                        'เพิ่มจำนวน ' + productName(line.productId)
                      "
                      (click)="changeQuantity(i, 1)"
                    >
                      +
                    </button>
                  </div>
                </li>
              }
            </ol>
            <div class="guest-cart-summary">
              <span>ยอดประมาณการ (ยังไม่ใช่ใบเสร็จ)</span>
              <strong>{{ money(estimate()) }} ฿</strong>
            </div>
            @if (notice()) {
              <p class="guest-warning" role="status">{{ notice() }}</p>
            }
            <button
              class="guest-checkout"
              type="button"
              [disabled]="busy() || !online()"
              (click)="checkout()"
            >
              {{
                busy()
                  ? "กำลังส่งออเดอร์ กรุณาอย่าปิดหน้า..."
                  : "ยืนยันส่งคำสั่งซื้อ (ยังไม่ชำระเงิน)"
              }}
            </button>
            <p class="guest-privacy">
              หากส่งไม่สำเร็จ ให้กดลองอีกครั้งโดยไม่แก้ไขตะกร้า
              ระบบใช้รหัสคำสั่งซื้อเดิมเพื่อป้องกันการสั่งซ้ำ
            </p>
          }
        </section>
      }
    </section>
  `,
})
export class GuestOrderPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(GuestOrderApi);
  private readonly document = inject(DOCUMENT);
  readonly session = inject(GuestOrderSession);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly search = signal("");
  readonly category = signal("");
  readonly selected = signal<Record<string, string[]>>({});
  readonly online = signal(true);
  readonly staticTable = signal<{ tenantId: string; storeId: string; tableId: string } | null>(null);
  readonly tableCode = signal("");
  readonly money = formatSatang;
  private scanToken: string | null = null;
  private readonly win = this.document.defaultView;
  readonly products = computed(() =>
    (this.session.visit()?.products ?? []).filter(
      (product) =>
        (!this.category() || product.categoryId === this.category()) &&
        product.name
          .toLocaleLowerCase("th-TH")
          .includes(this.search().trim().toLocaleLowerCase("th-TH")),
    ),
  );
  readonly cartQty = computed(() =>
    this.session.cart().reduce((sum, item) => sum + item.quantity, 0),
  );
  readonly estimate = computed(() =>
    this.session.visit()
      ? estimateSatang(this.session.visit()!, this.session.cart())
      : 0,
  );

  ngOnInit(): void {
    const win = this.win;
    this.online.set(win?.navigator.onLine ?? true);
    win?.addEventListener("online", this.goneOnline);
    win?.addEventListener("offline", this.goneOffline);
    const fragment = this.route.snapshot.fragment;
    if (fragment !== null) {
      // A bearer token in the fragment must leave the visible URL / history
      // immediately, before API calls or navigation; never put it in a query.
      win?.history.replaceState(
        win.history.state,
        "",
        win.location.pathname + win.location.search,
      );
      const token = sanitizedVisitToken(fragment);
      if (!token) {
        this.loading.set(false);
        this.error.set("QR สำหรับสั่งอาหารไม่ถูกต้อง กรุณาสแกน QR ใหม่");
        return;
      }
      this.scanToken = token;
      void this.load(token);
    } else if (this.route.snapshot.queryParamMap.keys.length > 0) {
      const query = this.route.snapshot.queryParamMap;
      const tenantId = query.get("tenant");
      const storeId = query.get("store");
      const tableId = query.get("table");
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      this.loading.set(false);
      this.session.invalidateVisit();
      if (query.keys.length !== 3 || !tenantId || !storeId || !tableId ||
          !uuid.test(tenantId) || !uuid.test(storeId) || !uuid.test(tableId)) {
        this.error.set("QR ติดโต๊ะไม่ถูกต้อง กรุณาสแกน QR ใหม่");
        return;
      }
      this.staticTable.set({ tenantId, storeId, tableId });
    } else if (this.session.visitToken()) {
      this.scanToken = this.session.visitToken();
      void this.load(this.session.visitToken()!);
    } else {
      this.loading.set(false);
      this.error.set("ไม่พบ QR สำหรับสั่งอาหาร กรุณาสแกน QR ของโต๊ะเพื่อเริ่ม");
    }
  }

  private readonly goneOnline = () => this.online.set(true);
  private readonly goneOffline = () => this.online.set(false);

  ngOnDestroy(): void {
    this.win?.removeEventListener("online", this.goneOnline);
    this.win?.removeEventListener("offline", this.goneOffline);
  }

  async reload(): Promise<void> {
    const token = this.session.visitToken() ?? this.scanToken;
    if (!token) {
      this.error.set("กรุณาสแกน QR ของโต๊ะใหม่เพื่อเริ่มสั่งอาหาร");
      return;
    }
    await this.load(token);
  }

  private async load(token: string): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      const visit = await this.api.resolve(token);
      this.session.setVisit(token, visit);
      this.selected.set({});
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.session.invalidateVisit();
        this.scanToken = null;
      }
      // Network/5xx failures are retryable with the in-memory visit token.
      // Never persist QR bearer in URL query, logs or localStorage.
      this.error.set(guestError(error));
    } finally {
      this.loading.set(false);
    }
  }

  updateTableCode(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.tableCode.set(event.target.value.replace(/[^0-9]/g, "").slice(0, 8));
    }
  }

  async submitTableCode(event: Event): Promise<void> {
    event.preventDefault();
    const table = this.staticTable();
    const code = this.tableCode();
    if (!table || !/^[0-9]{8}$/.test(code) || this.busy() || !this.online()) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const grant = await this.api.redeemCode(
        table.tenantId, table.storeId, table.tableId, code,
      );
      this.tableCode.set("");
      this.scanToken = grant.visitToken;
      await this.load(grant.visitToken);
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse && error.status === 404
          ? "รหัสไม่ถูกต้อง หมดอายุ หรือมีการขอรหัสผิดหลายครั้ง กรุณาติดต่อพนักงาน"
          : guestError(error),
      );
    } finally {
      this.busy.set(false);
    }
  }

  onSearch(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.search.set(event.target.value);
  }
  onCategory(event: Event): void {
    if (event.target instanceof HTMLSelectElement)
      this.category.set(event.target.value);
  }
  groups(productId: string): GuestModifierGroup[] {
    return (
      this.session
        .visit()
        ?.modifierGroups.filter((x) => x.productId === productId) ?? []
    );
  }
  options(groupId: string): GuestModifierOption[] {
    return (
      this.session
        .visit()
        ?.modifierOptions.filter((x) => x.groupId === groupId) ?? []
    );
  }
  categoryName(categoryId: string): string {
    return (
      this.session.visit()?.categories.find((x) => x.id === categoryId)?.name ??
      "เมนู"
    );
  }
  productName(productId: string): string {
    return (
      this.session.visit()?.products.find((x) => x.id === productId)?.name ??
      "สินค้า"
    );
  }
  selectionNames(optionIds: readonly string[]): string {
    const options = this.session.visit()?.modifierOptions ?? [];
    return optionIds
      .map((id) => options.find((x) => x.id === id)?.name ?? "ตัวเลือก")
      .join(" · ");
  }
  moneySigned(value: number): string {
    return value < 0 ? "-" + formatSatang(-value) : formatSatang(value);
  }
  isSelected(productId: string, optionId: string): boolean {
    return (this.selected()[productId] ?? []).includes(optionId);
  }
  optionDisabled(
    productId: string,
    group: GuestModifierGroup,
    optionId: string,
  ): boolean {
    const ids = this.selected()[productId] ?? [];
    return (
      !ids.includes(optionId) &&
      ids.filter((id) =>
        this.options(group.id).some((option) => option.id === id),
      ).length >= group.maxSelect
    );
  }
  toggleOption(
    productId: string,
    group: GuestModifierGroup,
    optionId: string,
  ): void {
    const ids = this.selected()[productId] ?? [];
    const next = ids.includes(optionId)
      ? ids.filter((x) => x !== optionId)
      : this.optionDisabled(productId, group, optionId)
        ? ids
        : [...ids, optionId];
    this.selected.update((values) => ({ ...values, [productId]: next }));
    this.notice.set("");
  }

  add(product: GuestProduct): void {
    const visit = this.session.visit();
    if (!visit) return;
    try {
      this.session.setCart(
        addToCart(
          visit,
          this.session.cart(),
          product.id,
          this.selected()[product.id] ?? [],
        ),
      );
      this.notice.set("เพิ่ม " + product.name + " ลงตะกร้าแล้ว");
    } catch (error) {
      this.notice.set(guestError(error));
    }
  }
  changeQuantity(index: number, amount: number): void {
    try {
      this.session.setCart(
        changeCartQuantity(this.session.cart(), index, amount),
      );
      this.notice.set("");
    } catch (error) {
      this.notice.set(guestError(error));
    }
  }

  async checkout(): Promise<void> {
    const token = this.session.visitToken();
    const visit = this.session.visit();
    const lines = this.session.cart();
    if (!token || !visit || !lines.length || this.busy() || !this.online())
      return;
    if (Date.now() >= new Date(visit.expiresAt).getTime()) {
      this.notice.set("QR โต๊ะหมดอายุแล้ว กรุณาสแกนใหม่");
      return;
    }
    for (const line of lines) {
      const invalid = selectedOptionError(
        visit,
        line.productId,
        line.optionIds,
      );
      if (invalid) {
        this.notice.set(invalid);
        return;
      }
    }
    this.busy.set(true);
    this.notice.set("");
    try {
      // Recheck the visit and merchant's current catalog before committing.
      // A changed price / sold-out menu requires explicit reconfirmation,
      // never silently accept a different amount than the guest reviewed.
      const latest = await this.api.resolve(token);
      const oldEstimate = estimateSatang(visit, lines);
      const newEstimate = estimateSatang(latest, lines);
      if (
        !Number.isFinite(newEstimate) ||
        newEstimate !== oldEstimate ||
        lines.some((line) =>
          selectedOptionError(latest, line.productId, line.optionIds),
        )
      ) {
        this.session.setVisit(token, latest);
        this.notice.set(
          "เมนู ราคา หรือความพร้อมเปลี่ยนไป โปรดตรวจสอบตะกร้าก่อนยืนยันอีกครั้ง",
        );
        return;
      }
      const key = this.session.keyFor(lines);
      const confirmed = await this.api.checkout(token, lines, key);
      // Server result is the only authoritative amount. Do not use cart
      // estimate as receipt, and do not show any "paid" success state.
      this.session.saveTracking(confirmed.orderId, confirmed.trackingToken);
      await this.router.navigateByUrl("/order/track");
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.session.invalidateVisit();
      }
      this.notice.set(guestError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
