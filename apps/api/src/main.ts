import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import type { IncomingMessage, ServerResponse } from "node:http";
import { installHttpTelemetry } from "./observability/http-telemetry";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  const origins = (process.env["CORS_ORIGINS"] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // No wildcard or implicit cross-origin credentials.
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true });
  }

  // Structured, safe-by-default request tracing (no URL, query, token or IP).
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    installHttpTelemetry(req, res);
    next();
  });

  // Raw WebP parser has a separate 192 KiB cap; standard JSON limits remain
  // unchanged. No base64 uploads or multipart paths reach this route.
  app.useBodyParser("raw", { type: "image/webp", limit: "192kb" });
  // Payment receipts: PNG-only, 512 KiB parser cap, validated before storage.
  app.useBodyParser("raw", { type: "image/png", limit: "512kb" });

  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  const port = Number(process.env["PORT"] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  // Default loopback for direct host/CI execution. Container orchestration may
  // explicitly bind to all container interfaces ONLY when ports are unpublished
  // and the API is reachable solely via the private Docker reverse proxy.
  const bindHost = process.env["RCAT_API_BIND_HOST"] ?? "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "0.0.0.0") {
    throw new Error("RCAT_API_BIND_HOST must be 127.0.0.1 or 0.0.0.0");
  }
  await app.listen(port, bindHost);
}

bootstrap().catch((error: unknown) => {
  console.error("RCAT POS API startup failed", error);
  process.exitCode = 1;
});
