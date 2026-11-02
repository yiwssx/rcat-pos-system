import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const origins = (process.env["CORS_ORIGINS"] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // No wildcard or implicit cross-origin credentials.
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true });
  }

  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  const port = Number(process.env["PORT"] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  await app.listen(port, "127.0.0.1");
}

bootstrap().catch((error: unknown) => {
  console.error("RCAT POS API startup failed", error);
  process.exitCode = 1;
});
