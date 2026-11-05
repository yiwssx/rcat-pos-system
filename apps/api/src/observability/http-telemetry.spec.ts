import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  httpRouteGroup, installHttpTelemetry, type HttpAccessRecord,
} from "./http-telemetry";

describe("G4 HTTP access telemetry", () => {
  it("never prints query, bearer path, user/session or tenant secrets", () => {
    const secret = "private-qr-or-tracking-token-and-credentials";
    const req = Object.assign(new EventEmitter(), {
      method: "POST",
      url: "/api/guest/track/" + secret + "?secret=" + secret,
      headers: { authorization: "Bearer " + secret, cookie: secret },
      socket: { remoteAddress: "127.0.0.1" },
    }) as IncomingMessage;
    const headers = new Map<string, string>();
    const res = Object.assign(new EventEmitter(), {
      statusCode: 401,
      setHeader: (name: string, value: string) => { headers.set(name, value); },
    }) as unknown as ServerResponse;
    const logged: HttpAccessRecord[] = [];
    installHttpTelemetry(req, res, (event) => logged.push(event));
    res.emit("finish");
    res.emit("close");
    expect(logged).toHaveLength(1);
    expect(logged[0].kind).toBe("http.request");
    expect(logged[0].routeGroup).toBe("guest");
    expect(logged[0].method).toBe("POST");
    expect(logged[0].statusCode).toBe(401);
    expect(logged[0].outcome).toBe("finished");
    expect(logged[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get("X-Request-Id")).toBe(logged[0].requestId);
    const serialized = JSON.stringify(logged[0]);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("cookie");
  });
  it("does not log unknown path components or URL injection", () => {
    expect(httpRouteGroup("/api/tenants/customer?pass=secret")).toBe("tenants");
    expect(httpRouteGroup("/api/guest/abc?token=xyz")).toBe("guest");
    expect(httpRouteGroup("/api/nonsense/private-value")).toBe("other");
    expect(httpRouteGroup("")).toBe("other");
  });
});
