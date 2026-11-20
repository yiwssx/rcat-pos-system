import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import {
  addToCart,
  changeCartQuantity,
  changeModifierSelection,
  cartNeedsReview,
  estimateSatang,
  formatSatang,
  formatOrderNumber,
  ORDER_STATUS_LABEL,
  GUEST_MENU_BATCH_SIZE,
  GuestCatalogCursor,
  mergeCartReview,
  normalizedItemNote,
  normalizedOrderContext,
  GuestOrderContext,
  GuestModifierGroup,
  GuestModifierOption,
  GuestProduct,
  sanitizedVisitToken,
  selectedOptionError,
} from "./guest-order.domain";
import {
  GuestOrderApi,
  GuestOrderSession,
  QuickGuestOrder,
} from "./guest-order.api";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import {
  HlmSheet,
  HlmSheetContent,
  HlmSheetFooter,
  HlmSheetHeader,
  HlmSheetPortal,
  HlmSheetTitle,
} from "@spartan-ng/helm/sheet";
import { GuestModifierChoicesComponent } from "./guest-modifier-choices.component";

function guestError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return "เชื่อมต่อไม่ได้ โปรดตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
    if (error.status === 404)
      return "ไม่พบข้อมูลที่ร้องขอ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง";
    if (error.status === 409) {
      if (
        (error.error as { message?: string } | null)?.message ===
        "ORDERING_CLOSED"
      )
        return "ขออภัย ร้านยังไม่เปิดให้สั่งอาหาร กรุณาลองใหม่ภายหลัง";
      return "คำสั่งซื้อถูกเปลี่ยนระหว่างส่ง โปรดตรวจสอบตะกร้าก่อนลองอีกครั้ง";
    }
    if (error.status === 429)
      return "มีการเรียกใช้งานจำนวนมาก กรุณารอสักครู่ก่อนลองใหม่";
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
  imports: [
    RouterLink,
    HlmButton,
    HlmInput,
    HlmSheet,
    HlmSheetContent,
    HlmSheetFooter,
    HlmSheetHeader,
    HlmSheetPortal,
    HlmSheetTitle,
    GuestModifierChoicesComponent,
  ],
  styleUrls: ["./guest-order.css", "./guest-order-ios.css"],
  template: `
    <section class="guest-shell v6-guest-shop" aria-labelledby="guest-title">
      <header class="guest-header">
        <div class="guest-brand">
          <img
            class="guest-brand-image"
            src="/rcat-pos-logo.webp"
            alt=""
            width="48"
            height="48"
          />
          <div class="guest-brand-copy">
            <span class="guest-menu-kicker">RCAT POS · MENU</span>
            <h1 id="guest-title">
              {{
                session.visit()?.storeName ||
                  closedStore()?.name ||
                  "สั่งอาหารผ่าน QR"
              }}
            </h1>
            <p class="guest-context">
              @if (session.visit(); as visit) {
                <strong>{{ visit.entryMode === "counter" ? "รับที่เคาน์เตอร์" : "โต๊ะ " + visit.tableLabel }}</strong> ·
                สั่งอาหารผ่านมือถือ
              } @else if (closedStore(); as closed) {
                {{ closed.table }}
              } @else {
                สแกน QR ร้านหรือโต๊ะเพื่อดูเมนู
              }
            </p>
          </div>
        </div>
        @if (!staticCounter()) {
          <a class="guest-track-link" routerLink="/order/track">ติดตามออเดอร์</a>
        }
      </header>

      @if (!online()) {
        <p class="guest-offline-alert" role="status">
          ออฟไลน์ · ยังไม่สามารถส่งออเดอร์ได้ ตะกร้าจะไม่ถูกส่งซ้ำอัตโนมัติ
        </p>
      }

      @if (closedStore(); as closed) {
        <section
          class="guest-closed"
          aria-labelledby="guest-closed-title"
          role="status"
        >
          <span class="guest-closed-symbol" aria-hidden="true">☕</span>
          <h2 id="guest-closed-title">ขออภัย ร้านยังไม่เปิดให้สั่งอาหาร</h2>
          <p>{{ closed.name }} · {{ closed.table }}</p>
          <p>กรุณาลองใหม่เมื่อร้านเปิดรับออเดอร์</p>
          <button
            type="button"
            (click)="reload()"
            [disabled]="loading() || !online()"
          >
            ตรวจสอบอีกครั้ง
          </button>
        </section>
      }

      @if (recoveryNotice() && session.visit()) {
        <p class="guest-recovery-notice" role="status">
          {{ recoveryNotice() }}
        </p>
      }

      @if (loading()) {
        <div class="guest-status" role="status">กำลังโหลดเมนูอาหาร...</div>
      } @else if (qrIssue(); as issue) {
        <section
          class="guest-qr-recovery"
          role="alert"
          aria-labelledby="guest-qr-recovery-title"
        >
          <span class="guest-qr-recovery-kicker">QR สำหรับสั่งอาหาร</span>
          <h2 id="guest-qr-recovery-title">
            @switch (issue) {
              @case ("reconnect") {
                รอบการสั่งเดิมสิ้นสุดแล้ว
              }
              @case ("unavailable") {
                ไม่พบโต๊ะนี้ในระบบ
              }
              @case ("missing") {
                ยังไม่ได้สแกน QR โต๊ะ
              }
              @default {
                QR นี้ใช้ไม่ได้แล้ว
              }
            }
          </h2>
          <p>
            @if (issue === "reconnect") {
              กรุณาตรวจสอบ QR กับร้าน แล้วกดเริ่มรอบใหม่ด้วยตนเอง
              รายการเดิมจะไม่ถูกส่งอัตโนมัติ
            } @else if (issue === "unavailable") {
              ไม่สามารถเปิดโต๊ะจาก QR นี้ได้ กรุณาตรวจสอบกับร้านหรือขอ QR
              โต๊ะที่ถูกต้อง
            } @else {
              กรุณาสแกน QR สำหรับสั่งอาหารจากร้านอีกครั้งเพื่อเริ่มรายการใหม่
            }
          </p>
          <div class="guest-qr-recovery-actions">
            @if (staticTable() || staticCounter()) {
              <button
                type="button"
                class="guest-qr-reconnect"
                (click)="reload()"
                [disabled]="loading() || !online()"
              >
                ยืนยันเริ่มรอบการสั่งใหม่
              </button>
            }
            <a routerLink="/" class="guest-qr-home">กลับหน้าแรก</a>
          </div>
        </section>
      } @else if (error()) {
        <div class="guest-error" role="alert">
          <p>{{ error() }}</p>
          <button type="button" (click)="reload()" [disabled]="loading()">
            ลองอีกครั้ง
          </button>
        </div>
      }

      @if (staticCounter() && session.visit()) {
        <details class="my-3 rounded-xl border border-border bg-card p-4 text-foreground" open>
          <summary class="cursor-pointer font-semibold">ออเดอร์ของฉัน ({{ quickOrders().length }})</summary>
          <div class="mt-3 space-y-3">
            <button hlmBtn variant="outline" type="button" class="min-h-11"
              [disabled]="quickLoading() || busy() || !online()" (click)="refreshQuickOrders()">
              อัปเดตสถานะ
            </button>
            @if (quickError()) {
              <p role="alert" class="text-sm text-destructive">{{ quickError() }}</p>
            }
            @for (order of quickOrders(); track order.orderId) {
              <div class="space-y-2 rounded-lg border border-border p-3">
                <p class="font-semibold">{{ orderNumber(order.displayNumber) }} · {{ statusLabel[order.status] }}</p>
                <p class="text-sm">ยอดออเดอร์ {{ money(order.amountSatang) }} ฿</p>
                <button hlmBtn variant="outline" type="button" class="min-h-11"
                  [disabled]="busy()" [attr.aria-pressed]="quickTarget() === order.orderId"
                  (click)="quickTarget.set(order.orderId)">
                  {{ order.status === "submitted" || order.status === "accepted" ? "เพิ่มรายการในออเดอร์นี้" : "สั่งเพิ่มเป็นออเดอร์ใหม่" }}
                </button>
              </div>
            }
            @if (quickTarget()) {
              <p class="text-sm" role="status">เลือกสั่งเพิ่มแล้ว หากร้านเริ่มเตรียม ระบบจะสร้างออเดอร์ใหม่</p>
              <button hlmBtn variant="outline" type="button" class="min-h-11" [disabled]="busy()" (click)="quickTarget.set(null)">สั่งเป็นออเดอร์ใหม่</button>
            }
          </div>
        </details>
      }
      @if (session.visit(); as visit) {
        <div class="guest-menu-intro v6-guest-intro">
          <div>
            <span class="guest-menu-kicker">เมนูของร้าน</span>
            <h2 class="guest-menu-intro-title">เลือกอาหารและเครื่องดื่ม</h2>
          </div>
          <span class="guest-table-chip">{{ visit.entryMode === "counter" ? "เคาน์เตอร์" : "โต๊ะ " + visit.tableLabel }}</span>
        </div>

        <div class="v6-guest-filters">
          <div class="guest-menu-toolbar">
            <label class="guest-search">
              <span class="guest-field-title">ค้นหาเมนู</span>
              <input
                hlmInput
                class="min-h-11"
                id="guest-menu-search"
                type="search"
                autocomplete="off"
                placeholder="ค้นหาอาหารหรือเครื่องดื่ม"
                [value]="search()"
                (input)="onSearch($event)"
              />
            </label>
          </div>
          <div class="guest-categories" role="group" aria-label="หมวดหมู่">
            <button
              class="guest-category-chip"
              type="button"
              [class.is-active]="category() === ''"
              [attr.aria-pressed]="category() === ''"
              (click)="onCategoryChip('')"
            >
              ทั้งหมด
            </button>
            @for (group of visit.categories; track group.id) {
              <button
                class="guest-category-chip"
                type="button"
                [class.is-active]="category() === group.id"
                [attr.aria-pressed]="category() === group.id"
                (click)="onCategoryChip(group.id)"
              >
                {{ group.name }}
              </button>
            }
          </div>
        </div>

        @if (products().length === 0 && !loading()) {
          <div class="guest-status" role="status">
            ไม่พบเมนูที่ต้องการ ลองค้นหาหรือเปลี่ยนหมวดหมู่
          </div>
        } @else {
          <div
            class="guest-products v6-guest-products"
            aria-label="รายการอาหาร"
          >
            @for (product of products(); track product.id) {
              <article
                class="guest-product v6-guest-product"
                [attr.aria-label]="product.name"
              >
                <button
                  type="button"
                  class="guest-product-media"
                  [attr.aria-label]="'ดูรายละเอียด ' + product.name"
                  [disabled]="busy()"
                  (click)="openProduct(product)"
                >
                  @if (product.hasImage) {
                    <img
                      class="guest-product-photo"
                      loading="lazy"
                      [src]="
                        productImageUrl(
                          visit.tenantId,
                          visit.storeId,
                          product.id
                        )
                      "
                      [alt]="'รูปภาพเมนู ' + product.name"
                    />
                  } @else {
                    <span class="guest-product-placeholder" aria-hidden="true"
                      >🍽️</span
                    >
                  }
                </button>
                <div class="guest-product-info v6-guest-product-info">
                  <span class="guest-product-category">{{
                    categoryName(product.categoryId)
                  }}</span>
                  <h2>{{ product.name }}</h2>
                  @if (groups(product.id).length > 0) {
                    <span class="guest-product-extra">มีตัวเลือกเพิ่มเติม</span>
                  }
                  <strong class="guest-price"
                    >{{ money(product.priceSatang) }} ฿</strong
                  >
                </div>
                <button
                  class="guest-add"
                  type="button"
                  aria-label="เพิ่มลงตะกร้า"
                  [disabled]="busy()"
                  (click)="addOrCustomize(product)"
                >
                  <span aria-hidden="true">+</span>
                  <span class="guest-visually-hidden">เพิ่มลงตะกร้า</span>
                </button>
              </article>
            }
          </div>
          <div class="guest-menu-progress" role="status" aria-live="polite">
            แสดง {{ products().length }} เมนู
            @if (hasMore()) {
              · ยังมีเมนูเพิ่มเติม
            }
          </div>
          @if (hasMore()) {
            <button
              class="guest-show-more"
              type="button"
              [disabled]="loadingMore() || loading() || !online()"
              (click)="showMore()"
            >
              {{ loadingMore() ? "กำลังโหลดเมนู..." : "แสดงเมนูเพิ่มเติม" }}
            </button>
          }
        }

        <p class="guest-payment-alert" role="note">
          หลังส่งออเดอร์
          สามารถตรวจสอบวิธีชำระเงินที่ร้านเปิดให้ใช้ได้ในหน้าติดตามคำสั่งซื้อ
        </p>
        @if (notice() && !cartOpen()) {
          <p class="guest-notice" role="status">{{ notice() }}</p>
        }
      }

      @if (session.visit() && cartQty() > 0) {
        <button
          type="button"
          class="guest-cart-shortcut"
          [disabled]="busy()"
          (click)="openCart()"
        >
          <span class="guest-cart-shortcut-count">
            <span class="guest-cart-shortcut-icon" aria-hidden="true">🛍️</span>
            ตะกร้า <strong>{{ cartQty() }} รายการ</strong>
          </span>
          <span class="guest-cart-shortcut-price"
            >≈ {{ money(estimate()) }} ฿</span
          >
          <span class="guest-cart-shortcut-action">ดูตะกร้า</span>
        </button>
      }

      <hlm-sheet #detailSheet side="bottom" (closed)="onDetailClose()">
        <ng-template hlmSheetPortal>
          <hlm-sheet-content
            class="guest-sheet guest-product-sheet mx-auto w-full max-w-2xl max-h-[min(92dvh,820px)] overflow-hidden rounded-t-3xl border border-border bg-card p-0 text-foreground shadow-xl md:max-h-[min(85dvh,820px)] md:rounded-3xl"
            [showCloseButton]="false"
          >
            @if (activeProduct(); as product) {
              <div class="guest-sheet-handle" aria-hidden="true"></div>
              <header hlmSheetHeader class="guest-sheet-heading">
                <div>
                  <span class="guest-menu-kicker">รายละเอียดอาหาร</span>
                  <h2 hlmSheetTitle>
                    {{ product.name }}
                  </h2>
                </div>
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon-lg"
                  class="min-h-11 min-w-11"
                  type="button"
                  aria-label="ปิดรายละเอียดสินค้า"
                  (click)="closeProduct()"
                >
                  ✕
                </button>
              </header>
              <div class="guest-sheet-scroll">
                <div class="guest-detail-media">
                  @if (product.hasImage && session.visit(); as visit) {
                    <img
                      loading="lazy"
                      [src]="
                        productImageUrl(
                          visit.tenantId,
                          visit.storeId,
                          product.id
                        )
                      "
                      [alt]="'รูปภาพเมนู ' + product.name"
                    />
                  } @else {
                    <span aria-hidden="true">🍽️</span>
                  }
                </div>
                <div class="guest-detail-subtitle">
                  <span>{{ categoryName(product.categoryId) }}</span>
                  <strong>{{ money(product.priceSatang) }} ฿</strong>
                </div>
                @for (group of groups(product.id); track group.id) {
                  <rcat-guest-modifier-choices
                    [group]="group"
                    [choices]="options(group.id)"
                    [selectedIds]="selected()[product.id] ?? []"
                    [busy]="busy()"
                    (clear)="clearOptionGroup(product.id, group)"
                    (optionToggle)="toggleOption(product.id, group, $event)"
                  />
                }
                <label class="guest-item-note">
                  <span>หมายเหตุสำหรับเมนูนี้ (ไม่บังคับ)</span>
                  <textarea
                    rows="2"
                    maxlength="240"
                    placeholder="เช่น ไม่ใส่ผัก แยกน้ำแข็ง"
                    [value]="detailNote()"
                    [disabled]="busy()"
                    (input)="onDetailNote($event)"
                  ></textarea>
                  <small>ส่งถึงร้านเฉพาะเมนูนี้ ไม่มีค่าใช้จ่ายเพิ่มเติม</small>
                </label>
                @if (detailError()) {
                  <p class="guest-warning" role="alert">{{ detailError() }}</p>
                }
              </div>
              <footer hlmSheetFooter class="guest-sheet-footer">
                <div class="guest-detail-quantity">
                  <span>จำนวน</span>
                  <div class="guest-qty">
                    <button
                      type="button"
                      aria-label="ลดจำนวน"
                      [disabled]="detailQty() <= 1"
                      (click)="changeDetailQty(-1)"
                    >
                      −
                    </button>
                    <strong>{{ detailQty() }}</strong>
                    <button
                      type="button"
                      aria-label="เพิ่มจำนวน"
                      [disabled]="detailQty() >= 20"
                      (click)="changeDetailQty(1)"
                    >
                      +
                    </button>
                  </div>
                </div>
                <button
                  hlmBtn
                  class="min-h-12 w-full text-base font-semibold"
                  type="button"
                  [disabled]="busy()"
                  (click)="addDetailProduct(product)"
                >
                  เพิ่มลงตะกร้า · ประมาณ {{ money(detailEstimate(product)) }} ฿
                </button>
              </footer>
            }
          </hlm-sheet-content>
        </ng-template>
      </hlm-sheet>

      <hlm-sheet #cartSheet side="bottom" (closed)="onCartClose()">
        <ng-template hlmSheetPortal>
          <hlm-sheet-content
            class="guest-sheet guest-cart-sheet mx-auto w-full max-w-2xl max-h-[min(92dvh,820px)] overflow-hidden rounded-t-3xl border border-border bg-card p-0 text-foreground shadow-xl md:max-h-[min(85dvh,820px)] md:rounded-3xl"
            [showCloseButton]="false"
          >
            <div class="guest-sheet-handle" aria-hidden="true"></div>
            <header hlmSheetHeader class="guest-sheet-heading">
              <div>
                <span class="guest-menu-kicker">ตรวจสอบก่อนส่ง</span>
                <h2 hlmSheetTitle>ตะกร้าของฉัน</h2>
                <span class="guest-cart-subtitle">{{ cartQty() }} รายการ</span>
              </div>
              <button
                hlmBtn
                variant="ghost"
                size="icon-lg"
                class="min-h-11 min-w-11"
                type="button"
                aria-label="ปิดตะกร้า"
                (click)="closeCart()"
              >
                ✕
              </button>
            </header>
            <div class="guest-sheet-scroll">
              @if (session.cart().length === 0) {
                <p class="guest-cart-empty">
                  ตะกร้ายังว่าง เลือกเมนูที่ชอบก่อนสั่งอาหาร
                </p>
              } @else {
                <ol class="guest-cart-lines">
                  @for (line of session.cart(); track $index; let i = $index) {
                    <li>
                      <div class="guest-cart-name">
                        <strong>{{ productName(line.productId) }}</strong>
                        <span>{{ selectionNames(line.optionIds) }}</span>
                        @if (line.note) {
                          <span class="guest-cart-note">
                            หมายเหตุ: {{ line.note }}
                          </span>
                        }
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
              }
              <fieldset class="guest-order-context">
                <legend>ข้อมูลผู้สั่งและจุดรับ/ส่ง</legend>
                <label for="guest-ordered-by">
                  ชื่อผู้สั่ง <span aria-hidden="true">*</span>
                </label>
                <input
                  hlmInput
                  class="min-h-11"
                  id="guest-ordered-by"
                  type="text"
                  autocomplete="nickname"
                  required
                  maxlength="80"
                  placeholder="เช่น คุณ ก หรือชื่อเล่น"
                  [value]="orderedBy()"
                  [disabled]="busy()"
                  (input)="onOrderedBy($event)"
                />
                <label for="guest-deliver-to">
                  สถานที่รับ/ส่ง <span aria-hidden="true">*</span>
                </label>
                <input
                  hlmInput
                  class="min-h-11"
                  id="guest-deliver-to"
                  type="text"
                  required
                  maxlength="160"
                  placeholder="เช่น อาคาร ข ชั้น 2"
                  [value]="deliverTo()"
                  [disabled]="busy()"
                  (input)="onDeliverTo($event)"
                />
                <small>
                  ทั้งสองช่องจำเป็นต้องกรอกก่อนส่งออเดอร์ ไม่ใช่ข้อมูลชำระเงิน
                </small>
              </fieldset>
              @if (notice() && cartOpen()) {
                <p class="guest-warning" role="status">{{ notice() }}</p>
              }
              <p class="guest-privacy">
                ยอดในตะกร้าเป็นประมาณการ
                ระบบจะตรวจสอบราคาและตัวเลือกอีกครั้งก่อนส่งออเดอร์
                ไม่ใช่การชำระเงิน
              </p>
            </div>
            <footer hlmSheetFooter class="guest-sheet-footer">
              <div class="guest-cart-summary">
                <span>ยอดประมาณการ</span>
                <strong>{{ money(estimate()) }} ฿</strong>
              </div>
              <button
                hlmBtn
                class="min-h-12 w-full text-base font-semibold"
                type="button"
                [disabled]="busy() || loading() || !online() || cartQty() === 0"
                (click)="checkout()"
              >
                {{
                  busy()
                    ? "กำลังส่งออเดอร์ กรุณาอย่าปิดหน้า..."
                    : staticCounter()
                      ? (quickTarget() ? "ยืนยันสั่งเพิ่ม" : "ยืนยันส่งคำสั่งซื้อ")
                      : "ยืนยันส่งคำสั่งซื้อและดูวิธีชำระเงิน"
                }}
              </button>
            </footer>
          </hlm-sheet-content>
        </ng-template>
      </hlm-sheet>
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
  readonly qrIssue = signal<
    "reconnect" | "unavailable" | "invalid" | "missing" | null
  >(null);
  readonly notice = signal("");
  readonly recoveryNotice = signal("");
  readonly search = signal("");
  readonly category = signal("");
  readonly hasMore = signal(false);
  readonly loadingMore = signal(false);
  readonly nextCursor = signal<GuestCatalogCursor | null>(null);
  readonly selected = signal<Record<string, string[]>>({});
  readonly activeProduct = signal<GuestProduct | null>(null);
  readonly detailQty = signal(1);
  readonly detailNote = signal("");
  readonly orderedBy = signal("");
  readonly deliverTo = signal("");
  readonly detailError = signal("");
  readonly cartOpen = signal(false);
  @ViewChild("detailSheet") private detailSheet?: HlmSheet;
  @ViewChild("cartSheet") private cartSheet?: HlmSheet;
  readonly online = signal(true);
  readonly staticTable = signal<{
    tenantId: string;
    storeId: string;
    tableId: string;
  } | null>(null);
  readonly staticCounter = signal<{
    tenantId: string;
    storeId: string;
    publicId: string;
  } | null>(null);
  readonly quickOrders = signal<QuickGuestOrder[]>([]);
  readonly quickTarget = signal<string | null>(null);
  readonly quickLoading = signal(false);
  readonly quickError = signal("");
  readonly orderNumber = formatOrderNumber;
  readonly statusLabel = ORDER_STATUS_LABEL;
  private entryStorageKey: string | null = null;
  readonly closedStore = signal<{ name: string; table: string } | null>(null);
  readonly money = formatSatang;
  readonly pageSize = GUEST_MENU_BATCH_SIZE;
  private scanToken: string | null = null;
  private readonly win = this.document.defaultView;
  readonly products = signal<GuestProduct[]>([]);
  private requestVersion = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
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
        this.session.invalidateVisit();
        this.qrIssue.set("invalid");
        return;
      }
      this.scanToken = token;
      void this.load(token);
    } else if (this.route.snapshot.queryParamMap.keys.length > 0) {
      const query = this.route.snapshot.queryParamMap;
      const tenantId = query.get("tenant");
      const storeId = query.get("store");
      const tableId = query.get("table");
      const publicId = query.get("counter");
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      this.loading.set(false);
      this.session.invalidateVisit();
      if (
        query.keys.length !== 3 ||
        !tenantId ||
        !storeId ||
        !uuid.test(tenantId) ||
        !uuid.test(storeId) ||
        Boolean(tableId) === Boolean(publicId) ||
        !uuid.test(tableId ?? publicId ?? "")
      ) {
        this.qrIssue.set("invalid");
        return;
      }
      if (tableId) this.staticTable.set({ tenantId, storeId, tableId });
      else if (publicId) this.staticCounter.set({ tenantId, storeId, publicId });
      this.entryStorageKey =
        "rcat-pos:qr-entry:v1:" + tenantId + ":" + storeId + ":" +
        (tableId ? "table:" + tableId : "counter:" + publicId);
      // Reload an existing possession grant, never silently mint a new one
      // after closure/revocation. Empty marker requires explicit action.
      try {
        const stored = win?.sessionStorage.getItem(this.entryStorageKey);
        if (stored && /^[A-Za-z0-9_-]{43}$/.test(stored)) {
          this.scanToken = stored;
          void this.load(stored);
        } else if (stored === null) {
          this.rememberEntry("");
          void this.openPrintedEntry();
        } else {
          this.qrIssue.set("reconnect");
        }
      } catch {
        this.qrIssue.set("reconnect");
      }
    } else if (this.session.visitToken()) {
      this.scanToken = this.session.visitToken();
      void this.load(this.session.visitToken()!);
    } else {
      this.loading.set(false);
      this.qrIssue.set("missing");
    }
  }

  private readonly goneOnline = () => this.online.set(true);
  private readonly goneOffline = () => this.online.set(false);

  ngOnDestroy(): void {
    this.win?.removeEventListener("online", this.goneOnline);
    this.win?.removeEventListener("offline", this.goneOffline);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.requestVersion += 1;
  }

  async reload(): Promise<void> {
    const token = this.session.visitToken() ?? this.scanToken;
    if (!token && (this.staticTable() || this.staticCounter())) {
      await this.openPrintedEntry();
      return;
    }
    if (!token) {
      this.qrIssue.set("missing");
      return;
    }
    await this.load(token);
  }

  private invalidateExpiredVisit(): void {
    // Revoked/expired tokens must never leave an actionable old cart or sheet.
    // The permanent printed QR may issue a *new* visit after explicit action.
    if (this.detailSheet?.stateComputed() === "open") this.closeProduct();
    if (this.cartSheet?.stateComputed() === "open") this.closeCart();
    this.session.invalidateVisit();
    this.scanToken = null;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
    this.products.set([]);
    this.nextCursor.set(null);
    this.hasMore.set(false);
    this.selected.set({});
    this.search.set("");
    this.category.set("");
    this.orderedBy.set("");
    this.deliverTo.set("");
    this.notice.set("");
    this.recoveryNotice.set("");
    this.error.set("");
    this.quickOrders.set([]);
    this.quickTarget.set(null);
    this.rememberEntry("");
    this.qrIssue.set(this.staticTable() || this.staticCounter() ? "reconnect" : "invalid");
  }

  private rememberEntry(token: string): void {
    if (!this.entryStorageKey) return;
    try {
      this.win?.sessionStorage.setItem(this.entryStorageKey, token);
    } catch {
      // A disabled storage session requires explicit re-entry after reload.
    }
  }

  private recoverExpiredPrintedVisit(): void {
    // Never automatically acquire another customer's table cycle.
    this.invalidateExpiredVisit();
  }

  async refreshQuickOrders(): Promise<void> {
    const token = this.session.visitToken();
    if (!this.staticCounter() || !token || this.quickLoading()) return;
    this.quickLoading.set(true);
    this.quickError.set("");
    try {
      const result = await this.api.quickOrders(token);
      if (this.session.visitToken() === token) this.quickOrders.set(result.orders);
    } catch (error) {
      if (this.session.visitToken() !== token) return;
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.invalidateExpiredVisit();
      } else {
        this.quickError.set(guestError(error));
      }
    } finally {
      this.quickLoading.set(false);
    }
  }

  private menuPage(token: string, cursor: GuestCatalogCursor | null = null) {
    return this.staticCounter()
      ? this.api.counterPage(token, this.search(), this.category() || null, cursor)
      : this.api.page(token, this.search(), this.category() || null, cursor);
  }

  private async load(token: string): Promise<void> {
    const version = ++this.requestVersion;
    this.loading.set(true);
    this.loadingMore.set(false);
    this.error.set("");
    this.qrIssue.set(null);
    try {
      const page = await this.menuPage(token);
      if (version !== this.requestVersion) return;
      this.session.setPage(token, page);
      this.products.set(page.products);
      this.nextCursor.set(page.nextCursor);
      this.hasMore.set(page.hasMore);
      this.selected.set({});
      if (this.staticCounter()) void this.refreshQuickOrders();
    } catch (error) {
      if (version !== this.requestVersion) return;
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.recoverExpiredPrintedVisit();
      } else {
        this.error.set(guestError(error));
      }
    } finally {
      if (version === this.requestVersion) this.loading.set(false);
    }
  }

  private scheduleSearchReload(delay: number): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    // Invalidate in-flight pages immediately, before the debounce expires.
    this.requestVersion += 1;
    this.products.set([]);
    this.hasMore.set(false);
    this.nextCursor.set(null);
    this.loadingMore.set(false);
    this.loading.set(true);
    const token = this.session.visitToken() ?? this.scanToken;
    if (!token) {
      this.loading.set(false);
      return;
    }
    this.searchTimer = setTimeout(() => {
      this.searchTimer = undefined;
      void this.load(token);
    }, delay);
  }

  private async openPrintedEntry(): Promise<void> {
    const table = this.staticTable();
    const counter = this.staticCounter();
    if ((!table && !counter) || !this.online()) return;
    const version = ++this.requestVersion;
    this.loading.set(true);
    this.error.set("");
    this.qrIssue.set(null);
    this.closedStore.set(null);
    this.products.set([]);
    this.session.invalidateVisit();
    this.quickOrders.set([]);
    this.quickTarget.set(null);
    this.scanToken = null;
    this.rememberEntry("");
    try {
      const state = counter
        ? await this.api.openPrintedStore(counter.tenantId, counter.storeId, counter.publicId)
        : await this.api.openPrintedTable(table!.tenantId, table!.storeId, table!.tableId);
      if (version !== this.requestVersion) return;
      if (!state.open) {
        this.closedStore.set({
          name: state.storeName,
          table: "tableLabel" in state ? "โต๊ะ " + state.tableLabel : "เคาน์เตอร์",
        });
        return;
      }
      const token = "guestToken" in state ? state.guestToken : state.visitToken;
      this.scanToken = token;
      this.rememberEntry(token);
      if (counter) this.deliverTo.set("เคาน์เตอร์");
      await this.load(token);
    } catch (error) {
      if (version === this.requestVersion) {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.qrIssue.set("unavailable");
        } else {
          this.error.set(guestError(error));
        }
      }
    } finally {
      if (version === this.requestVersion) this.loading.set(false);
    }
  }

  productImageUrl(tenant: string, store: string, product: string): string {
    return (
      "/api/guest/catalog-media/" +
      encodeURIComponent(tenant) +
      "/" +
      encodeURIComponent(store) +
      "/" +
      encodeURIComponent(product)
    );
  }

  onSearch(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.search.set(event.target.value);
      this.scheduleSearchReload(300);
    }
  }

  onCategoryChip(categoryId: string): void {
    if (this.category() === categoryId) return;
    this.category.set(categoryId);
    this.scheduleSearchReload(0);
  }

  async showMore(): Promise<void> {
    const token = this.session.visitToken();
    const cursor = this.nextCursor();
    if (
      !token ||
      !cursor ||
      this.loadingMore() ||
      this.loading() ||
      this.busy() ||
      !this.online()
    )
      return;
    const version = this.requestVersion;
    this.loadingMore.set(true);
    this.notice.set("");
    try {
      const page = await this.menuPage(token, cursor);
      if (version !== this.requestVersion) return;
      if (!page.products.length && page.hasMore) {
        throw new Error("เมนูของร้านเปลี่ยนระหว่างโหลด กรุณาค้นหาใหม่");
      }
      this.session.setPage(token, page);
      const already = new Set(this.products().map((p) => p.id));
      this.products.update((old) => [
        ...old,
        ...page.products.filter((p) => !already.has(p.id)),
      ]);
      this.nextCursor.set(page.nextCursor);
      this.hasMore.set(page.hasMore);
    } catch (error) {
      if (version === this.requestVersion) {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.recoverExpiredPrintedVisit();
        } else {
          this.notice.set(guestError(error));
        }
      }
    } finally {
      if (version === this.requestVersion) this.loadingMore.set(false);
    }
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
  private updateOptionGroup(
    productId: string,
    group: GuestModifierGroup,
    optionId: string | null,
  ): void {
    const visit = this.session.visit();
    if (!visit || this.busy()) return;
    try {
      const next = changeModifierSelection(
        visit,
        productId,
        group.id,
        this.selected()[productId] ?? [],
        optionId,
      );
      this.selected.update((values) => ({ ...values, [productId]: next }));
      this.notice.set("");
      this.detailError.set("");
    } catch (error) {
      this.detailError.set(guestError(error));
    }
  }
  toggleOption(
    productId: string,
    group: GuestModifierGroup,
    optionId: string,
  ): void {
    this.updateOptionGroup(productId, group, optionId);
  }
  clearOptionGroup(productId: string, group: GuestModifierGroup): void {
    this.updateOptionGroup(productId, group, null);
  }

  addOrCustomize(product: GuestProduct): void {
    // Always expose the optional per-item note, even with no modifiers.
    this.openProduct(product);
  }
  onDetailNote(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) {
      this.detailNote.set(event.target.value);
      this.detailError.set("");
    }
  }
  onOrderedBy(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.orderedBy.set(event.target.value);
      this.notice.set("");
    }
  }
  onDeliverTo(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.deliverTo.set(event.target.value);
      this.notice.set("");
    }
  }
  openProduct(product: GuestProduct): void {
    if (this.busy()) return;
    this.detailError.set("");
    this.detailQty.set(1);
    this.detailNote.set("");
    // A fresh product sheet must not silently reuse the previous item's choices.
    this.selected.update((values) => ({ ...values, [product.id]: [] }));
    this.activeProduct.set(product);
    this.detailSheet?.open();
  }
  closeProduct(): void {
    this.detailSheet?.close();
  }
  onDetailClose(): void {
    this.activeProduct.set(null);
    this.detailQty.set(1);
    this.detailNote.set("");
    this.detailError.set("");
  }
  changeDetailQty(delta: number): void {
    this.detailQty.update((qty) => Math.max(1, Math.min(20, qty + delta)));
  }
  detailEstimate(product: GuestProduct): number {
    const ids = this.selected()[product.id] ?? [];
    const extras = this.session.visit()?.modifierOptions ?? [];
    const unit = ids.reduce((sum, id) => {
      const option = extras.find(
        (entry) => entry.productId === product.id && entry.id === id,
      );
      return sum + (option?.priceDeltaSatang ?? 0);
    }, product.priceSatang);
    return Math.max(0, unit * this.detailQty());
  }
  addDetailProduct(product: GuestProduct): void {
    const visit = this.session.visit();
    if (!visit || this.busy()) return;
    const ids = this.selected()[product.id] ?? [];
    try {
      const note = normalizedItemNote(this.detailNote());
      let cart = this.session.cart();
      for (let index = 0; index < this.detailQty(); index += 1) {
        cart = addToCart(visit, cart, product.id, ids, note);
      }
      this.session.setCart(cart);
      this.notice.set("เพิ่ม " + product.name + " ลงตะกร้าแล้ว");
      this.closeProduct();
    } catch (error) {
      this.detailError.set(guestError(error));
    }
  }
  openCart(): void {
    if (this.cartSheet?.stateComputed() === "open") return;
    this.cartOpen.set(true);
    this.cartSheet?.open();
  }
  closeCart(): void {
    this.cartSheet?.close();
  }
  onCartClose(): void {
    this.cartOpen.set(false);
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
    if (
      !token ||
      !visit ||
      !lines.length ||
      this.busy() ||
      this.loading() ||
      !this.online()
    )
      return;
    let context: GuestOrderContext;
    try {
      context = normalizedOrderContext({
        orderedBy: this.orderedBy(),
        deliverTo: this.deliverTo(),
      });
    } catch (error) {
      this.notice.set(guestError(error));
      return;
    }
    if (Date.now() >= new Date(visit.expiresAt).getTime()) {
      this.closeCart();
      this.invalidateExpiredVisit();
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
      // The scoped review fetches only selected cart products and choices,
      // not an unbounded store-wide menu snapshot. Checkout remains the
      // final transactional validation; changes require fresh confirmation.
      const latest = await (this.staticCounter()
        ? this.api.counterReview(token, lines)
        : this.api.reviewCart(token, lines));
      if (cartNeedsReview(visit, latest, lines)) {
        const merged = mergeCartReview(visit, latest, lines);
        this.session.setVisit(token, merged);
        const fresh = new Map(latest.products.map((p) => [p.id, p]));
        const selected = new Set(lines.map((line) => line.productId));
        this.products.update((old) =>
          old.flatMap((item) =>
            selected.has(item.id)
              ? fresh.has(item.id)
                ? [fresh.get(item.id)!]
                : []
              : [item],
          ),
        );
        this.notice.set(
          "เมนู ราคา หรือความพร้อมเปลี่ยนไป โปรดตรวจสอบตะกร้าก่อนยืนยันอีกครั้ง",
        );
        return;
      }
      const target = this.staticCounter() ? this.quickTarget() : null;
      const key = this.session.keyFor(lines, context, target);
      if (this.staticCounter()) {
        const result = await this.api.quickCheckout(token, lines, context, key, target);
        this.session.setCart([]);
        this.quickTarget.set(null);
        this.closeCart();
        this.notice.set(
          (result.action === "appended" ? "เพิ่มรายการสำเร็จ " :
            result.action === "new_after_cutoff" ? "ร้านเริ่มเตรียมแล้ว สร้างออเดอร์ใหม่ " :
              "ส่งออเดอร์สำเร็จ ") + this.orderNumber(result.displayNumber) +
            " · ยอด " + this.money(result.amountSatang) + " ฿",
        );
        await this.refreshQuickOrders();
        return;
      }
      const confirmed = await this.api.checkout(token, lines, context, key);
      // Server result is the only authoritative amount. Do not use cart
      // estimate as receipt, and do not show any "paid" success state.
      this.session.saveTracking(confirmed.orderId, confirmed.trackingToken);
      await this.router.navigateByUrl("/order/track");
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.closeCart();
        this.invalidateExpiredVisit();
        return;
      }
      if (
        error instanceof HttpErrorResponse &&
        error.status === 409 &&
        (error.error as { message?: string } | null)?.message ===
          "ORDERING_CLOSED"
      ) {
        this.closeCart();
        this.session.invalidateVisit();
        this.closedStore.set({
          name: visit.storeName,
          table: visit.entryMode === "counter" ? "เคาน์เตอร์" : "โต๊ะ " + visit.tableLabel,
        });
        this.products.set([]);
      }
      this.notice.set(guestError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
