import type { MerchantNotificationEvent } from "./merchant-notifications.service";

// Pure SSE framing: safe to test without instantiating decorated NestJS classes.
export function encodeOrderSse(event: MerchantNotificationEvent): string {
  if (!/^[1-9][0-9]{0,18}$/.test(event.eventId)) {
    throw new Error("Invalid Order outbox event ID");
  }
  // SSE data contains only server-scoped, non-sensitive event references.
  // No merchant, customer or table QR capability / price / payment data.
  const data = JSON.stringify({
    eventId: event.eventId,
    orderId: event.orderId,
    eventType: event.eventType,
    status: event.status,
  });
  return `id: ${event.eventId}\nevent: order-event\ndata: ${data}\n\n`;
}
