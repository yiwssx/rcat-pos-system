import { describe, expect, it } from "vitest";
import { routes } from "./app.routes";
import {
  formatUnits,
  lowStock,
  stocktakeDifference,
  validPhysicalCount,
  toMilliUnits,
  validStockInput,
  validRecoverableReturnQuantity,
} from "./inventory.domain";
import {
  formatReportSatang,
  formatReportSeconds,
  operationalReportPath,
  todayBangkok,
} from "./operational-report.domain";
import {
  appendOrderPage,
  formatSatang,
  hasEventCoverage,
  mergeEvents,
  missingOrderIds,
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

  it("lazy loads the store-scoped operational report for owners", () => {
    expect(
      routes.find((route) => route.path === "reports/:tenantId/:storeId")
        ?.loadComponent,
    ).toBeTypeOf("function");
  });

  it("lazy loads inventory scoped to tenant/store, without Payment", () => {
    expect(
      routes.find((route) => route.path === "inventory/:tenantId/:storeId")
        ?.loadComponent,
    ).toBeTypeOf("function");
  });

  it("lazy loads the scoped two-person Stocktake workflow", () => {
    expect(
      routes.find(
        (route) => route.path === "inventory/:tenantId/:storeId/stocktakes",
      )?.loadComponent,
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
    expect(merged.map((o) => o.orderId)).toEqual(["repeat", "newer", "older"]);
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

  it("recovers 1200-Order backlogs through exact event IDs rather than 20 Inbox pages", () => {
    const historical = Array.from({ length: 1200 }, (_, i) =>
      order("old-" + i),
    );
    const recentPage = historical.slice(1150);
    const missing = missingOrderIds(new Set(["old-1", "old-1199"]), recentPage);
    expect(missing).toEqual(["old-1"]);
    const resolved = appendOrderPage(recentPage, [historical[1]!]);
    expect(
      hasEventCoverage(
        [event("21", "old-1"), event("22", "old-1199")],
        resolved,
      ),
    ).toBe(true);
    expect(missingOrderIds(new Set(["foreign-id"]), resolved)).toEqual([
      "foreign-id",
    ]);
  });

  it("bounds the recent activity feed to 30 events", () => {
    const events = Array.from({ length: 75 }, (_, i) => event(String(i + 1)));
    const out = mergeEvents([], events);
    expect(out).toHaveLength(30);
    expect(out[0]?.eventId).toBe("75");
    expect(out[out.length - 1]?.eventId).toBe("46");
  });
});

describe("operational report without Payment", () => {
  it("uses Asia/Bangkok business day independent from UTC date", () => {
    expect(todayBangkok(new Date("2026-11-03T20:00:00.000Z"))).toBe(
      "2026-11-04",
    );
    expect(todayBangkok(new Date("2026-11-04T16:59:59.000Z"))).toBe(
      "2026-11-04",
    );
    expect(todayBangkok(new Date("2026-11-04T17:00:00.000Z"))).toBe(
      "2026-11-05",
    );
  });

  it("formats arbitrarily large integer-satang snapshots exactly", () => {
    expect(formatReportSatang("9007199254740993")).toMatch(/\.93$/);
    expect(formatReportSatang("0")).toMatch(/\.00$/);
    expect(formatReportSatang("-1")).toBe("—");
    expect(formatReportSatang("1.05")).toBe("—");
    expect(formatReportSeconds(null)).toBe("ไม่มีข้อมูล");
    expect(formatReportSeconds(121)).toContain("2 นาที");
  });

  it("encodes scopes and never constructs Payment API paths", () => {
    expect(operationalReportPath("tenant", "store")).toBe(
      "/api/tenants/tenant/stores/store/reports/operations",
    );
    expect(operationalReportPath("../tenant", "store?other")).not.toContain(
      "/../",
    );
    expect(operationalReportPath("a", "b")).not.toContain("/payments");
  });
});

describe("exact inventory quantities and shortage indicators", () => {
  it("uses BigInt for exact g/ml/unit stock thresholds", () => {
    expect(toMilliUnits("9007199254740.993")).toBe(9007199254740993n);
    expect(formatUnits("2000.125")).toContain("2");
    expect(formatUnits("-0.500")).toContain("-0.5");
    expect(toMilliUnits("1.0001")).toBe(null);
    expect(toMilliUnits("1e5")).toBe(null);
    expect(validStockInput("100.005", { zero: false })).toBe(true);
    expect(validStockInput("-100.005", { zero: false, negative: true })).toBe(
      true,
    );
    expect(validStockInput("-100.005", { zero: false })).toBe(false);
    expect(validStockInput("0", { zero: false })).toBe(false);
    expect(
      lowStock({
        itemId: "1",
        name: "Rice",
        unit: "g",
        onHand: "9.999",
        reorderAt: "10",
      }),
    ).toBe(true);
    expect(
      lowStock({
        itemId: "1",
        name: "Rice",
        unit: "g",
        onHand: "10.001",
        reorderAt: "10",
      }),
    ).toBe(false);
  });
});

describe("two-person Stocktake client invariants", () => {
  it("validates exact physical quantities and never allows negative stock", () => {
    expect(validPhysicalCount("0")).toBe(true);
    expect(validPhysicalCount("1000000000000")).toBe(true);
    expect(validPhysicalCount("1000000000000.001")).toBe(false);
    expect(validPhysicalCount("-0.001")).toBe(false);
    expect(validPhysicalCount("10.0001")).toBe(false);
    expect(validPhysicalCount("1e4")).toBe(false);
  });
  it("calculates adjustment preview with exact BigInt thousandths", () => {
    expect(stocktakeDifference("975.500", "1000.125")).toBe("-24.625");
    expect(stocktakeDifference("1000.125", "975.500")).toBe("+24.625");
    expect(stocktakeDifference("100", "100")).toBe("+0.000");
    expect(stocktakeDifference(null, "100")).toBe("—");
  });
});

describe("G3 exceptional return Merchant safeguards", () => {
  it("lazily loads the scoped Order exception flow, never Payment", () => {
    expect(
      routes.find((route) =>
        route.path === "inventory/:tenantId/:storeId/exception-returns/:orderId",
      )?.loadComponent,
    ).toBeTypeOf("function");
    expect(routes.some((route) => route.path?.includes("payment"))).toBe(false);
  });
  it("never exceeds original unreturned allocation and uses exact milliquantity", () => {
    expect(validRecoverableReturnQuantity("100.125", "100.125")).toBe(true);
    expect(validRecoverableReturnQuantity("100.126", "100.125")).toBe(false);
    expect(validRecoverableReturnQuantity("0", "100")).toBe(false);
    expect(validRecoverableReturnQuantity("-1", "100")).toBe(false);
    expect(validRecoverableReturnQuantity("1.0001", "100")).toBe(false);
    expect(validRecoverableReturnQuantity("1e2", "100")).toBe(false);
    expect(validRecoverableReturnQuantity("1000000001", "1000000001")).toBe(false);
  });
});
