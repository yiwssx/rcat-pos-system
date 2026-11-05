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
export interface CartLine {
  productId: string;
  optionIds: string[];
  quantity: number;
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
export interface GuestOrderStatus {
  orderId: string;
  status: "submitted" | "accepted" | "preparing" | "served" | "cancelled";
  amountSatang: number;
  currency: "THB";
  paymentState: "not_requested";
  createdAt: string;
  updatedAt: string;
}
export interface GuestOrderHistory {
  orderId: string;
  status: GuestOrderStatus["status"];
  paymentState: "not_requested";
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

export function addToCart(
  visit: GuestVisit,
  current: readonly CartLine[],
  productId: string,
  optionIds: readonly string[],
): CartLine[] {
  const invalid = selectedOptionError(visit, productId, optionIds);
  if (invalid) throw new Error(invalid);
  const canonical = [...optionIds].sort();
  const index = current.findIndex(
    (item) =>
      item.productId === productId &&
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
    lines.push({ productId, optionIds: canonical, quantity: 1 });
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
