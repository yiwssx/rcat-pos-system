export type MerchantRole = "owner" | "manager" | "cashier" | "kitchen";
export type OrderStatus =
  "submitted" | "accepted" | "preparing" | "served" | "cancelled";

export interface MerchantStore {
  tenantId: string;
  storeId: string;
  tenantName: string;
  storeName: string;
  role: MerchantRole;
}

export interface OrderItem {
  productName: string;
  quantity: number;
  lineTotalSatang: number;
  options: readonly { name: string; priceDeltaSatang: number }[];
}

export interface MerchantOrder {
  orderId: string;
  tableId: string;
  visitId: string;
  amountSatang: number;
  currency: "THB";
  status: OrderStatus;
  paymentState: "not_requested";
  createdAt: string;
  updatedAt: string;
  items: readonly OrderItem[];
}

export interface OrderEvent {
  eventId: string;
  eventType: "order.submitted" | "order.status.changed";
  orderId: string;
  tableId: string;
  status: OrderStatus;
  previousStatus: OrderStatus | null;
  occurredAt: string;
}

export interface OrderEventPage {
  events: OrderEvent[];
  nextCursor: string;
  acknowledgedCursor: string;
  hasMore: boolean;
}

export interface OrderHistory {
  orderId: string;
  status: OrderStatus;
  paymentState: "not_requested";
  events: {
    eventId: number | null;
    status: OrderStatus;
    fromStatus: OrderStatus | null;
    occurredAt: string;
    actorUserId?: string;
  }[];
}

export interface OrderAction {
  label: string;
  nextStatus: OrderStatus;
  destructive?: boolean;
}

export const STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  submitted: "รอรับออเดอร์",
  accepted: "รับออเดอร์แล้ว",
  preparing: "กำลังเตรียม",
  served: "เสิร์ฟแล้ว",
  cancelled: "ยกเลิก",
};

export const ROLE_LABEL: Readonly<Record<MerchantRole, string>> = {
  owner: "เจ้าของร้าน",
  manager: "ผู้จัดการ",
  cashier: "แคชเชียร์",
  kitchen: "พนักงานครัว",
};

export function orderActions(
  status: OrderStatus,
  role: MerchantRole,
): readonly OrderAction[] {
  const mayManage = role === "owner" || role === "manager";
  if (status === "submitted") {
    return mayManage || role === "cashier"
      ? [
          { label: "รับออเดอร์", nextStatus: "accepted" },
          {
            label: "ยกเลิกออเดอร์",
            nextStatus: "cancelled",
            destructive: true,
          },
        ]
      : [];
  }
  if (status === "accepted") {
    const actions: OrderAction[] = [];
    if (mayManage || role === "kitchen") {
      actions.push({ label: "เริ่มเตรียม", nextStatus: "preparing" });
    }
    if (mayManage || role === "cashier") {
      actions.push({
        label: "ยกเลิกออเดอร์",
        nextStatus: "cancelled",
        destructive: true,
      });
    }
    return actions;
  }
  if (status === "preparing" && (mayManage || role === "kitchen")) {
    return [{ label: "เสิร์ฟแล้ว", nextStatus: "served" }];
  }
  return [];
}

export function formatSatang(satang: number): string {
  if (!Number.isSafeInteger(satang) || satang < 0) return "—";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(satang / 100);
}

export function mergeEvents(
  current: readonly OrderEvent[],
  incoming: readonly OrderEvent[],
): OrderEvent[] {
  const byId = new Map<string, OrderEvent>();
  for (const event of current) byId.set(event.eventId, event);
  for (const event of incoming) byId.set(event.eventId, event);
  // Store latest event IDs, using BigInt rather than imprecise JS numbers.
  return [...byId.values()]
    .sort((a, b) => (BigInt(a.eventId) < BigInt(b.eventId) ? 1 : -1))
    .slice(0, 30);
}

export function hasEventCoverage(
  events: readonly OrderEvent[],
  orders: readonly MerchantOrder[],
): boolean {
  const visible = new Set(orders.map((order) => order.orderId));
  return events.every((event) => visible.has(event.orderId));
}
