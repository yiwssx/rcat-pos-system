import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import type { ApiRequest } from "../auth/request-security";
import { MerchantNotificationStreamService } from "./merchant-notification-stream.service";
import type { MerchantNotificationsService } from "./merchant-notifications.service";
import { encodeOrderSse } from "./merchant-notification-stream.core";
import type { MerchantNotificationEvent } from "./merchant-notifications.service";

describe("durable merchant SSE envelope", () => {
  const event: MerchantNotificationEvent = {
    eventId: "9007199254740993",
    eventType: "order.status.changed",
    orderId: "11111111-1111-4111-8111-111111111111",
    tableId: "22222222-2222-4222-8222-222222222222",
    status: "accepted",
    previousStatus: "submitted",
    occurredAt: "2026-11-04T05:00:00Z",
  };

  it("preserves a 64-bit event ID as an SSE string, never a JS Number", () => {
    const frame = encodeOrderSse(event);
    expect(frame).toContain("id: 9007199254740993\n");
    expect(frame).toContain("event: order-event\n");
    expect(frame.endsWith("\n\n")).toBe(true);
    const data = frame.split("\n").find((line) => line.startsWith("data: "));
    expect(data).toBeDefined();
    expect(JSON.parse(data!.slice(6))).toEqual({
      eventId: "9007199254740993",
      orderId: event.orderId,
      eventType: "order.status.changed",
      status: "accepted",
    });
  });

  it("never leaks token capabilities, payments, actor IDs, or item snapshots", () => {
    const frame = encodeOrderSse({
      ...event,
      // Guard future changes against accidental serialization of extra data.
      trackingToken: "forbidden",
      amountSatang: 9000,
      actorUserId: "forbidden",
    } as MerchantNotificationEvent);
    expect(frame).not.toContain("trackingToken");
    expect(frame).not.toContain("amountSatang");
    expect(frame).not.toContain("actorUserId");
    expect(frame).not.toContain("tableId");
    expect(frame).not.toContain("payment");
  });

  it("rejects a line-injected Last-Event-ID stored as event data", () => {
    expect(() =>
      encodeOrderSse({ ...event, eventId: "1\nevent: forgery" }),
    ).toThrow("Invalid Order outbox event ID");
    expect(() => encodeOrderSse({ ...event, eventId: "0" })).toThrow();
    expect(() => encodeOrderSse({ ...event, eventId: "-1" })).toThrow();
  });
});

describe("SSE slow-reader backpressure", () => {
  it("releases sockets immediately on write(false) without buffering or losing durable events", async () => {
    const event: MerchantNotificationEvent = {
      eventId: "19",
      eventType: "order.submitted",
      orderId: "11111111-1111-4111-8111-111111111111",
      tableId: "22222222-2222-4222-8222-222222222222",
      status: "submitted",
      previousStatus: null,
      occurredAt: "2026-11-05T05:00:00Z",
    };
    const list = {
      events: [event], nextCursor: "19",
      acknowledgedCursor: "0", hasMore: false,
    };
    let reads = 0;
    const notifications = {
      list: async () => { reads++; return list; },
    } as unknown as MerchantNotificationsService;
    const stream = new MerchantNotificationStreamService(notifications);
    const tenant = "00000000-0000-4000-8000-000000000001";
    const store = "20000000-0000-4000-8000-000000000001";
    // Forty sequential slow clients exceed the 32-live-connection cap,
    // so failed cleanup would eventually reject a healthy next client.
    for (let i = 0; i < 40; i++) {
      const emitter = new EventEmitter();
      const written: string[] = [];
      let ended = false;
      const response = Object.assign(emitter, {
        statusCode: 0,
        writableEnded: false,
        destroyed: false,
        setHeader: (_key: string, _value: string) => undefined,
        flushHeaders: () => undefined,
        write(frame: string) {
          written.push(frame);
          return written.length < 2; // welcome succeeds; Order event stalls.
        },
        end() { ended = true; this.writableEnded = true; },
      });
      await stream.open(
        {} as ApiRequest,
        response as unknown as ServerResponse,
        tenant, store,
      );
      expect(response.statusCode).toBe(200);
      expect(written).toHaveLength(2);
      expect(written[0]).toContain("retry:");
      expect(written[1]).toContain("id: 19");
      expect(ended).toBe(true);
      expect(response.listenerCount("close")).toBe(0);
      expect(response.listenerCount("error")).toBe(0);
    }
    expect(reads).toBe(40); // Every reconnect must query durable DB replay.
  });
});
