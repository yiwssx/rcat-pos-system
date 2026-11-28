import type { GuestOrderStatus, GuestPaymentState } from "./guest-order.domain";

export const TRACKING_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const TRACKING_MAX_ORDERS = 50;
export const TRACKING_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TRACKING_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface GuestTracking {
  orderId: string;
  trackingToken: string;
  createdAt: number;
  expiresAt?: number;
  displayNumber?: string;
  summary?: {
    amountSatang: number;
    status: GuestOrderStatus["status"];
    paymentState: GuestPaymentState;
    checkedAt: number;
  };
}

export const GUEST_PAYMENT_LABEL: Readonly<Record<GuestPaymentState, string>> =
  {
    not_requested: "ยังไม่เปิดคำขอชำระ",
    awaiting_payment: "รอชำระ / ส่งสลิปใหม่",
    slip_submitted: "ส่งสลิปแล้ว · รอร้านตรวจ",
    manual_confirmed: "ร้านยืนยันรับเงินแล้ว",
  };

function parsed(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function validTracking(raw: unknown, now: number): GuestTracking | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r["orderId"] !== "string" ||
    !TRACKING_ID.test(r["orderId"]) ||
    typeof r["trackingToken"] !== "string" ||
    !TRACKING_TOKEN.test(r["trackingToken"]) ||
    typeof r["createdAt"] !== "number" ||
    !Number.isFinite(r["createdAt"]) ||
    r["createdAt"] > now ||
    now - r["createdAt"] >= TRACKING_MAX_AGE_MS ||
    (r["expiresAt"] !== undefined &&
      (typeof r["expiresAt"] !== "number" ||
        !Number.isFinite(r["expiresAt"]) ||
        r["expiresAt"] <= now))
  )
    return null;
  const entry: GuestTracking = {
    orderId: r["orderId"].toLowerCase(),
    trackingToken: r["trackingToken"],
    createdAt: r["createdAt"],
  };
  if (typeof r["expiresAt"] === "number") entry.expiresAt = r["expiresAt"];
  if (
    typeof r["displayNumber"] === "string" &&
    /^[1-9][0-9]{0,18}$/.test(r["displayNumber"])
  ) {
    entry.displayNumber = r["displayNumber"];
  }
  const s = r["summary"];
  if (s && typeof s === "object") {
    const a = s as Record<string, unknown>;
    if (
      typeof a["amountSatang"] === "number" &&
      Number.isSafeInteger(a["amountSatang"]) &&
      a["amountSatang"] >= 0 &&
      a["amountSatang"] <= 100_000_000 &&
      typeof a["status"] === "string" &&
      ["submitted", "accepted", "preparing", "served", "cancelled"].includes(
        a["status"],
      ) &&
      typeof a["paymentState"] === "string" &&
      Object.prototype.hasOwnProperty.call(
        GUEST_PAYMENT_LABEL,
        a["paymentState"],
      ) &&
      typeof a["checkedAt"] === "number" &&
      Number.isFinite(a["checkedAt"]) &&
      a["checkedAt"] <= now
    ) {
      entry.summary = {
        amountSatang: a["amountSatang"],
        status: a["status"] as GuestOrderStatus["status"],
        paymentState: a["paymentState"] as GuestPaymentState,
        checkedAt: a["checkedAt"],
      };
    }
  }
  return entry;
}

// Merge the old single-record key with the new list without extending an
// existing capability's lifetime. No table QR or public IDs recover others.
export function restoreTrackingList(
  listRaw: string | null,
  activeRaw: string | null,
  now: number,
): {
  orders: GuestTracking[];
  active: GuestTracking | null;
} {
  const list = parsed(listRaw);
  const active = validTracking(parsed(activeRaw), now);
  const byId = new Map<string, GuestTracking>();
  for (const raw of Array.isArray(list)
    ? list.slice(0, TRACKING_MAX_ORDERS)
    : []) {
    const entry = validTracking(raw, now);
    if (entry && !byId.has(entry.orderId)) byId.set(entry.orderId, entry);
  }
  if (active && !byId.has(active.orderId)) byId.set(active.orderId, active);
  const orders = [...byId.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, TRACKING_MAX_ORDERS);
  return {
    orders,
    active:
      orders.find((o) => o.orderId === active?.orderId) ?? orders[0] ?? null,
  };
}

export function parseRecoveryFragment(
  fragment: string,
): { orderId: string; claimToken: string } | null {
  const [orderId, claimToken, extra] = fragment.replace(/^#/, "").split(".");
  return orderId &&
    claimToken &&
    extra === undefined &&
    TRACKING_ID.test(orderId) &&
    TRACKING_TOKEN.test(claimToken)
    ? { orderId: orderId.toLowerCase(), claimToken }
    : null;
}
