import { describe, expect, it } from "vitest";
import { routes } from "./app.routes";
import {
  appendOrderPage,
  formatSatang,
  hasEventCoverage,
  mergeEvents,
  MerchantOrder,
  OrderEvent,
  orderActions,
} from "./order-board.domain";

describe("merchant operations routes", () => {
  it("lazy-loads the store-scoped Order board and status page", () => {
    expect(routes[0]?.path).toBe("");
    expect(
      routes.find((route) => route.path === "orders/:tenantId/:storeId")
        ?.loadComponent,
    ).toBeTypeOf("function");
    expect(
      routes.find((route) => route.path === "status")?.loadComponent,
    ).toBeTypeOf("function");
  });

  it("does not expose a payment route", () => {
    expect(routes.some((route) => route.path?.includes("payment"))).toBe(false);
  });
});

describe("merchant fulfilment permissions", () => {
  it("matches the server role-specific transition policy", () => {
    expect(orderActions("submitted", "kitchen")).toEqual([]);
    expect(
      orderActions("submitted", "cashier").map((x) => x.nextStatus),
    ).toEqual(["accepted", "cancelled"]);
    expect(
      orderActions("accepted", "kitchen").map((x) => x.nextStatus),
    ).toEqual(["preparing"]);
    expect(
      orderActions("accepted", "cashier").map((x) => x.nextStatus),
    ).toEqual(["cancelled"]);
    expect(orderActions("accepted", "owner").map((x) => x.nextStatus)).toEqual([
      "preparing",
      "cancelled",
    ]);
    expect(
      orderActions("preparing", "kitchen").map((x) => x.nextStatus),
    ).toEqual(["served"]);
    expect(orderActions("served", "owner")).toEqual([]);
    expect(orderActions("cancelled", "manager")).toEqual([]);
  });

  it("does not interpret an Order total as paid", () => {
    expect(formatSatang(20800)).toMatch(/208[.,]00/);
    expect(formatSatang(-1)).toBe("—");
    expect(formatSatang(Number.NaN)).toBe("—");
  });
});

describe("durable outbox projection", () => {
  const event = (id: string, orderId = "order-one"): OrderEvent => ({
    eventId: id,
    eventType: "order.submitted",
    orderId,
    tableId: "table-one",
    status: "submitted",
    previousStatus: null,
    occurredAt: "2026-11-03T00:00:00.000Z",
  });
  const order = (id: string): MerchantOrder => ({
    orderId: id,
    tableId: "table-one",
    visitId: "visit-one",
    amountSatang: 10000,
    currency: "THB",
    status: "submitted",
    paymentState: "not_requested",
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
    items: [],
  });

  it("deduplicates repeated events and compares bigint cursors exactly", () => {
    const out = mergeEvents(
      [event("9007199254740992"), event("2")],
      [event("9007199254740993"), event("2")],
    );
    expect(out.map((e) => e.eventId)).toEqual([
      "9007199254740993",
      "9007199254740992",
      "2",
    ]);
  });

  it("does not acknowledge an event whose Order is outside the loaded inbox", () => {
    expect(
      hasEventCoverage(
        [event("10", "visible"), event("11", "older")],
        [order("visible")],
      ),
    ).toBe(false);
    expect(hasEventCoverage([event("10", "visible")], [order("visible")])).toBe(
      true,
    );
  });

  it("deduplicates overlapping keyset pages without overwriting newer statuses", () => {
    const latest = { ...order("repeat"), status: "served" as const };
    const historical = { ...order("repeat"), status: "submitted" as const };
    const merged = appendOrderPage(
      [latest, order("newer")],
      [historical, order("older")],
    );
    expect(merged.map((o) => o.orderId)).toEqual([
      "repeat", "newer", "older",
    ]);
    expect(merged[0]?.status).toBe("served");
    expect(merged.every((o) => o.paymentState === "not_requested")).toBe(true);
  });

  it("recognizes outbox coverage when paged Orders span beyond the first 50", () => {
    const older = event("100", "older");
    const recent = event("101", "recent");
    expect(hasEventCoverage([older, recent], [order("recent")])).toBe(false);
    const recovered = appendOrderPage(
      [order("recent")],
      [order("older"), order("recent")],
    );
    expect(hasEventCoverage([older, recent], recovered)).toBe(true);
  });

  it("bounds the recent activity feed to 30 events", () => {
    const events = Array.from({ length: 75 }, (_, i) => event(String(i + 1)));
    const out = mergeEvents([], events);
    expect(out).toHaveLength(30);
    expect(out[0]?.eventId).toBe("75");
    expect(out[out.length - 1]?.eventId).toBe("46");
  });
});
