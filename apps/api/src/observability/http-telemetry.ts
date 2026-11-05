import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";

// No query, path parameters, URLs, cookies, IP addresses, headers or request
// bodies may enter these access logs. A bearer Order-tracking token may be
// embedded in any URL, including unusual error paths.
export function httpRouteGroup(rawUrl: string | undefined): string {
  const path = (rawUrl ?? "").split("?", 1)[0] ?? "";
  const segments = path.split("/").filter(Boolean);
  if (segments[0] !== "api") return "other";
  const group = segments[1] ?? "root";
  const allowed = new Set(["health", "ready", "auth", "guest", "tenants"]);
  return allowed.has(group) ? group : "other";
}

export interface HttpAccessRecord {
  kind: "http.request";
  requestId: string;
  method: string;
  routeGroup: string;
  statusCode: number;
  durationMs: number;
  outcome: "finished" | "disconnected";
}

export function installHttpTelemetry(
  req: IncomingMessage,
  res: ServerResponse,
  emit: (record: HttpAccessRecord) => void = (record) =>
    console.log(JSON.stringify(record)),
): void {
  const requestId = randomUUID();
  const started = performance.now();
  res.setHeader("X-Request-Id", requestId);
  let recorded = false;
  const record = (outcome: HttpAccessRecord["outcome"]): void => {
    if (recorded) return;
    recorded = true;
    emit({
      kind: "http.request",
      requestId,
      method: /^[A-Z]{1,12}$/.test(req.method ?? "") ? req.method! : "OTHER",
      routeGroup: httpRouteGroup(req.url),
      statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - started),
      outcome,
    });
  };
  res.once("finish", () => record("finished"));
  res.once("close", () => record("disconnected"));
}
