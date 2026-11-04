import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ServerResponse } from "node:http";
import { ApiRequest } from "../auth/request-security";
import { encodeOrderSse } from "./merchant-notification-stream.core";
import {
  MerchantNotificationPage,
  MerchantNotificationsService,
} from "./merchant-notifications.service";

const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_MS = 15_000;
const MAX_STREAM_AGE_MS = 15 * 60_000;
const MAX_LOCAL_CONNECTIONS = 32;
const RECONNECT_MS = 5_000;

@Injectable()
export class MerchantNotificationStreamService {
  private activeStreams = 0;

  constructor(private readonly notifications: MerchantNotificationsService) {}

  async open(
    req: ApiRequest,
    res: ServerResponse,
    tenantId: string,
    storeId: string,
  ): Promise<void> {
    // Authenticate the session AND verify the staff/tenant/store association
    // BEFORE sending HTTP 200 or reserving a long-lived server connection.
    // Initial SSE replay is based on durable staff acknowledgement, never on
    // untrusted Last-Event-ID, which may be ahead of unacknowledged Orders.
    const initial = await this.notifications.list(
      req,
      tenantId,
      storeId,
      undefined,
      "50",
    );

    if (this.activeStreams >= MAX_LOCAL_CONNECTIONS) {
      throw new ServiceUnavailableException("Too many notification streams");
    }
    this.activeStreams += 1;

    let live = true;
    let cursor = initial.acknowledgedCursor;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let lastBeat = Date.now();
    let age: ReturnType<typeof setTimeout> | undefined;

    const stop = (endResponse = false): void => {
      if (!live) return;
      live = false;
      this.activeStreams -= 1;
      if (scheduled) clearTimeout(scheduled);
      if (age) clearTimeout(age);
      res.off("close", onClose);
      res.off("error", onClose);
      if (endResponse && !res.writableEnded && !res.destroyed) res.end();
    };
    const onClose = (): void => stop();

    const write = (frame: string): boolean => {
      if (!live || res.writableEnded || res.destroyed) {
        stop();
        return false;
      }
      // A slow reader must not accumulate unbounded buffers. Disconnect and
      // let EventSource reconnect from the persisted acknowledgement cursor.
      if (!res.write(frame)) {
        stop(true);
        return false;
      }
      return true;
    };

    const schedule = (ms: number): void => {
      if (live) scheduled = setTimeout(() => void pump(), ms);
    };

    const pump = async (first?: MerchantNotificationPage): Promise<void> => {
      if (!live) return;
      try {
        // Each iteration validates session expiry/revocation and membership.
        // The PostgreSQL pool is acquired only for this bounded read; no DB
        // connection is pinned for the lifetime of the SSE stream.
        const page =
          first ??
          (await this.notifications.list(req, tenantId, storeId, cursor, "50"));
        if (!live) return;
        if (
          !Array.isArray(page.events) ||
          typeof page.nextCursor !== "string" ||
          typeof page.hasMore !== "boolean"
        ) {
          throw new Error("Invalid notification page");
        }
        for (const event of page.events) {
          if (!write(encodeOrderSse(event))) return;
          cursor = event.eventId;
          lastBeat = Date.now();
        }
        if (Date.now() - lastBeat >= HEARTBEAT_MS) {
          if (!write(": keepalive\n\n")) return;
          lastBeat = Date.now();
        }
        // A backlog drains in bounded pages; an empty feed uses 3s polling.
        // Server-side polling is a wake-up mechanism, not the durable source.
        schedule(
          page.hasMore && page.events.length > 0 ? 50 : POLL_INTERVAL_MS,
        );
      } catch (error) {
        if (!live) return;
        const status =
          error instanceof HttpException ? error.getStatus() : undefined;
        const revoked = status === 401 || status === 403 || status === 404;
        const type = revoked ? "access-revoked" : "stream-error";
        write(
          `event: ${type}\ndata: {"reason":"${revoked ? "access_unavailable" : "retry"}"}\n\n`,
        );
        stop(true);
      }
    };

    try {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Connection", "keep-alive");
      res.on("close", onClose);
      res.on("error", onClose);
      res.flushHeaders();
      if (!write(`retry: ${RECONNECT_MS}\n: connected\n\n`)) return;
      age = setTimeout(() => stop(true), MAX_STREAM_AGE_MS);
      // Initial delivery also starts from the confirmed staff cursor, not
      // from EventSource's advisory Last-Event-ID header.
      await pump(initial);
    } catch (error) {
      stop(true);
      throw error;
    }
  }
}
