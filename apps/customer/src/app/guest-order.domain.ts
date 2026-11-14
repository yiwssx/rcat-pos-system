export interface GuestCategory {
  id: string;
  name: string;
  slug: string;
}
export interface GuestProduct {
  id: string;
  hasImage: boolean;
  categoryId: string;
  name: string;
  priceSatang: number;
}
export interface GuestModifierGroup {
  id: string;
  productId: string;
  name: string;
  slug: string;
  minSelect: number;
  maxSelect: number;
}
export interface GuestModifierOption {
  id: string;
  productId: string;
  groupId: string;
  name: string;
  priceDeltaSatang: number;
}
export interface GuestVisit {
  visitId: string;
  tenantId: string;
  storeId: string;
  tableId: string;
  tableLabel: string;
  storeName: string;
  expiresAt: string;
  categories: GuestCategory[];
  products: GuestProduct[];
  modifierGroups: GuestModifierGroup[];
  modifierOptions: GuestModifierOption[];
}
export interface GuestCatalogCursor {
  createdAt: string;
  id: string;
}

export interface GuestCatalogPage extends GuestVisit {
  hasMore: boolean;
  nextCursor: GuestCatalogCursor | null;
}

export interface CartLine {
  productId: string;
  optionIds: string[];
  quantity: number;
  note?: string;
}
export interface GuestOrderContext {
  orderedBy: string;
  deliverTo: string;
}

export function normalizeOrderField(
  value: string,
  maxLength: number,
  label: string,
  required = true,
): string {
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if ((required && !normalized) || Array.from(normalized).length > maxLength) {
    throw new Error(`กรุณาระบุ${label} (ไม่เกิน ${maxLength} ตัวอักษร)`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label}มีอักขระไม่ถูกต้อง`);
  }
  return normalized;
}

export function normalizedOrderContext(
  context: GuestOrderContext,
): GuestOrderContext {
  return {
    orderedBy: normalizeOrderField(context.orderedBy, 80, "ชื่อผู้สั่ง"),
    deliverTo: normalizeOrderField(context.deliverTo, 160, "สถานที่รับ/ส่ง"),
  };
}
export function normalizedItemNote(note: string): string {
  return normalizeOrderField(note, 240, "หมายเหตุสินค้า", false);
}
export interface GuestCheckout {
  orderId: string;
  trackingToken: string;
  amountSatang: number;
  currency: "THB";
  status: "submitted";
  paymentState: "not_requested";
  replayed: boolean;
}
export interface GuestActivePaymentRequest {
  available: true;
  requestId: string;
  orderId: string;
  amountSatang: number;
  currency: "THB";
  state: "awaiting_payment";
  createdAt: string;
  qrImageDataUrl: string;
  merchantConfirmation: false;
}
export type GuestPaymentRequest =
  | { available: false }
  | GuestActivePaymentRequest;

export interface GuestOrderStatus {
  orderId: string;
  status: "submitted" | "accepted" | "preparing" | "served" | "cancelled";
  amountSatang: number;
  currency: "THB";
  paymentState: "not_requested" | "awaiting_payment";
  createdAt: string;
  updatedAt: string;
}
export interface GuestOrderHistory {
  orderId: string;
  status: GuestOrderStatus["status"];
  paymentState: "not_requested" | "awaiting_payment";
  events: {
    status: GuestOrderStatus["status"];
    fromStatus: GuestOrderStatus["status"] | null;
    occurredAt: string;
  }[];
}
export const ORDER_STATUS_LABEL: Readonly<
  Record<GuestOrderStatus["status"], string>
> = {
  submitted: "ส่งคำสั่งซื้อแล้ว",
  accepted: "ร้านรับออเดอร์แล้ว",
  preparing: "กำลังเตรียม",
  served: "เสิร์ฟแล้ว",
  cancelled: "ร้านยกเลิกออเดอร์",
};
const MAX_CART_LINES = 20;
const MAX_TOTAL_QTY = 100;

// Progressive rendering only: this does not change the authoritative server
// menu snapshot or Checkout validation. Filtering preserves the server order.
export const GUEST_MENU_BATCH_SIZE = 24;

export function filterGuestMenu(
  visit: GuestVisit,
  search: string,
  categoryId: string,
): GuestProduct[] {
  const normalized = search.trim().toLocaleLowerCase("th-TH");
  return visit.products.filter(
    (product) =>
      (!categoryId || product.categoryId === categoryId) &&
      product.name.toLocaleLowerCase("th-TH").includes(normalized),
  );
}

export function estimateSatang(
  visit: GuestVisit,
  lines: readonly CartLine[],
): number {
  let total = 0;
  for (const line of lines) {
    const product = visit.products.find((p) => p.id === line.productId);
    if (!product) return NaN;
    const options = line.optionIds.map((id) =>
      visit.modifierOptions.find(
        (option) => option.id === id && option.productId === line.productId,
      ),
    );
    if (options.some((option) => !option)) return NaN;
    const unit =
      product.priceSatang +
      options.reduce((sum, option) => sum + (option?.priceDeltaSatang ?? 0), 0);
    if (!Number.isSafeInteger(unit) || unit <= 0) return NaN;
    total += unit * line.quantity;
  }
  return Number.isSafeInteger(total) && total >= 0 ? total : NaN;
}

export function selectedOptionError(
  visit: GuestVisit,
  productId: string,
  optionIds: readonly string[],
): string | null {
  if (!visit.products.some((p) => p.id === productId)) {
    return "สินค้านี้ไม่มีในเมนูปัจจุบัน";
  }
  if (new Set(optionIds).size !== optionIds.length || optionIds.length > 32) {
    return "ตัวเลือกสินค้าซ้ำหรือมากเกินไป";
  }
  const selected = optionIds.map((id) =>
    visit.modifierOptions.find(
      (option) => option.id === id && option.productId === productId,
    ),
  );
  if (selected.some((option) => !option)) {
    return "มีตัวเลือกที่ร้านไม่เปิดให้บริการแล้ว";
  }
  for (const group of visit.modifierGroups.filter(
    (g) => g.productId === productId,
  )) {
    const count = selected.filter(
      (option) => option?.groupId === group.id,
    ).length;
    if (count < group.minSelect || count > group.maxSelect) {
      return `กรุณาเลือก "${group.name}" จำนวน ${group.minSelect}–${group.maxSelect} รายการ`;
    }
  }
  return null;
}

/**
 * Never infer approval from the cart's aggregate total alone. Different
 * products/modifiers may have compensating price changes, while a Merchant
 * can rename an item without changing its price. Ask for a fresh review when
 * anything relevant to a submitted cart changed since the guest saw it.
 * The PostgreSQL checkout remains authoritative under concurrent edits.
 */
/**
 * The server returns only cart-selected products/options. Preserve the menu
 * already paged into memory; replace all selected-product snapshots so a
 * removed item/option can never be treated as still orderable on retry.
 */
export function mergeCartReview(
  reviewed: GuestVisit,
  fresh: GuestVisit,
  lines: readonly CartLine[],
): GuestVisit {
  if (
    fresh.visitId !== reviewed.visitId ||
    fresh.tenantId !== reviewed.tenantId ||
    fresh.storeId !== reviewed.storeId ||
    fresh.tableId !== reviewed.tableId
  ) {
    return fresh;
  }
  const selected = new Set(lines.map((line) => line.productId));
  const selectedOptionIds = new Set(lines.flatMap((line) => line.optionIds));
  const categories = new Map(reviewed.categories.map((c) => [c.id, c]));
  fresh.categories.forEach((c) => categories.set(c.id, c));
  return {
    ...reviewed,
    ...fresh,
    categories: [...categories.values()],
    products: [
      ...reviewed.products.filter((p) => !selected.has(p.id)),
      ...fresh.products,
    ],
    modifierGroups: [
      ...reviewed.modifierGroups.filter((g) => !selected.has(g.productId)),
      ...fresh.modifierGroups,
    ],
    modifierOptions: [
      ...reviewed.modifierOptions.filter(
        (o) => !selected.has(o.productId) && !selectedOptionIds.has(o.id),
      ),
      ...fresh.modifierOptions,
    ],
  };
}

export function cartNeedsReview(
  reviewed: GuestVisit,
  current: GuestVisit,
  lines: readonly CartLine[],
): boolean {
  if (
    reviewed.visitId !== current.visitId ||
    reviewed.tableId !== current.tableId ||
    reviewed.storeId !== current.storeId ||
    lines.length === 0
  )
    return true;

  const before = estimateSatang(reviewed, lines);
  const after = estimateSatang(current, lines);
  if (
    !Number.isSafeInteger(before) ||
    !Number.isSafeInteger(after) ||
    before !== after ||
    before < 1 ||
    after > 100000000
  )
    return true;

  for (const line of lines) {
    if (
      selectedOptionError(reviewed, line.productId, line.optionIds) ||
      selectedOptionError(current, line.productId, line.optionIds)
    )
      return true;
    const a = reviewed.products.find((p) => p.id === line.productId);
    const b = current.products.find((p) => p.id === line.productId);
    if (
      !a ||
      !b ||
      a.name !== b.name ||
      a.categoryId !== b.categoryId ||
      a.priceSatang !== b.priceSatang
    )
      return true;

    const catA = reviewed.categories.find((c) => c.id === a.categoryId);
    const catB = current.categories.find((c) => c.id === b.categoryId);
    if (!catA || !catB || catA.name !== catB.name) return true;

    const oldGroups = reviewed.modifierGroups
      .filter((g) => g.productId === line.productId)
      .sort((x, y) => x.id.localeCompare(y.id));
    const newGroups = current.modifierGroups
      .filter((g) => g.productId === line.productId)
      .sort((x, y) => x.id.localeCompare(y.id));
    if (
      oldGroups.length !== newGroups.length ||
      oldGroups.some((g, i) => {
        const next = newGroups[i];
        return (
          !next ||
          g.id !== next.id ||
          g.name !== next.name ||
          g.slug !== next.slug ||
          g.minSelect !== next.minSelect ||
          g.maxSelect !== next.maxSelect
        );
      })
    )
      return true;

    for (const id of line.optionIds) {
      const oldOption = reviewed.modifierOptions.find((o) => o.id === id);
      const newOption = current.modifierOptions.find((o) => o.id === id);
      if (
        !oldOption ||
        !newOption ||
        oldOption.productId !== newOption.productId ||
        oldOption.groupId !== newOption.groupId ||
        oldOption.name !== newOption.name ||
        oldOption.priceDeltaSatang !== newOption.priceDeltaSatang
      )
        return true;
    }
  }
  return false;
}

/**
 * Single-select modifier groups behave as a radio group. Optional single
 * groups support an explicit "no option" choice; multiple groups toggle
 * independently. Always preserve selections belonging to other groups.
 * Checkout still enforces the server-owned min/max and price rules.
 */
export function changeModifierSelection(
  visit: GuestVisit,
  productId: string,
  groupId: string,
  selectedIds: readonly string[],
  optionId: string | null,
): string[] {
  const group = visit.modifierGroups.find(
    (entry) => entry.id === groupId && entry.productId === productId,
  );
  if (!group) throw new Error("กลุ่มตัวเลือกไม่ถูกต้อง");
  const optionIds = new Set(
    visit.modifierOptions
      .filter(
        (option) =>
          option.productId === productId && option.groupId === groupId,
      )
      .map((option) => option.id),
  );
  if (optionId === null) {
    if (group.maxSelect !== 1 || group.minSelect !== 0) {
      throw new Error("ต้องเลือกตัวเลือกในกลุ่มนี้");
    }
    return selectedIds.filter((id) => !optionIds.has(id));
  }
  if (!optionIds.has(optionId)) throw new Error("ตัวเลือกสินค้าไม่ถูกต้อง");
  const inGroup = selectedIds.filter((id) => optionIds.has(id));
  if (group.maxSelect === 1) {
    return [...selectedIds.filter((id) => !optionIds.has(id)), optionId];
  }
  if (inGroup.includes(optionId)) {
    return selectedIds.filter((id) => id !== optionId);
  }
  if (inGroup.length >= group.maxSelect) return [...selectedIds];
  return [...selectedIds, optionId];
}

export function addToCart(
  visit: GuestVisit,
  current: readonly CartLine[],
  productId: string,
  optionIds: readonly string[],
  note = "",
): CartLine[] {
  const normalizedNote = normalizedItemNote(note);
  const invalid = selectedOptionError(visit, productId, optionIds);
  if (invalid) throw new Error(invalid);
  const canonical = [...optionIds].sort();
  const index = current.findIndex(
    (item) =>
      item.productId === productId &&
      (item.note ?? "") === normalizedNote &&
      item.optionIds.length === canonical.length &&
      item.optionIds.every((id, i) => id === canonical[i]),
  );
  if (index === -1 && current.length >= MAX_CART_LINES) {
    throw new Error("ตะกร้าเต็ม (สูงสุด 20 รายการ)");
  }
  const lines = current.map((line) => ({
    ...line,
    optionIds: [...line.optionIds],
  }));
  if (index === -1) {
    lines.push({
      productId,
      optionIds: canonical,
      quantity: 1,
      ...(normalizedNote ? { note: normalizedNote } : {}),
    });
  } else {
    const item = lines[index]!;
    if (item.quantity >= 20) throw new Error("สั่งสินค้านี้ได้สูงสุด 20 ชิ้น");
    lines[index] = { ...item, quantity: item.quantity + 1 };
  }
  if (lines.reduce((sum, line) => sum + line.quantity, 0) > MAX_TOTAL_QTY) {
    throw new Error("คำสั่งซื้อรวมได้สูงสุด 100 ชิ้น");
  }
  if (!Number.isFinite(estimateSatang(visit, lines))) {
    throw new Error("ราคาประมาณการไม่ถูกต้อง กรุณาเลือกเมนูใหม่");
  }
  return lines;
}

export function changeCartQuantity(
  lines: readonly CartLine[],
  index: number,
  amount: number,
): CartLine[] {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= lines.length ||
    !Number.isInteger(amount) ||
    ![-1, 1].includes(amount)
  ) {
    throw new Error("การเปลี่ยนจำนวนไม่ถูกต้อง");
  }
  const current = lines[index]!;
  const quantity = current.quantity + amount;
  if (quantity > 20) throw new Error("สินค้าหนึ่งรายการได้สูงสุด 20 ชิ้น");
  if (quantity < 1) return lines.filter((_item, i) => i !== index);
  if (
    amount > 0 &&
    lines.reduce((sum, item) => sum + item.quantity, 0) >= MAX_TOTAL_QTY
  ) {
    throw new Error("คำสั่งซื้อรวมได้สูงสุด 100 ชิ้น");
  }
  return lines.map((item, i) => (i === index ? { ...item, quantity } : item));
}

export function formatSatang(value: number): string {
  return Number.isSafeInteger(value) && value >= 0
    ? new Intl.NumberFormat("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100)
    : "—";
}

export function sanitizedVisitToken(fragment: string | null): string | null {
  if (!fragment) return null;
  const params = new URLSearchParams(fragment);
  const tokens = params.getAll("token");
  return tokens.length === 1 &&
    params.size === 1 &&
    /^[A-Za-z0-9_-]{43}$/.test(tokens[0] ?? "")
    ? tokens[0]!
    : null;
}
