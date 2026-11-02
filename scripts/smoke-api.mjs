import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const port = 31911;
const origin = `http://127.0.0.1:${port}`;
let output = "";
const server = spawn(process.execPath, ["dist/apps/api/main.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), CORS_ORIGINS: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += String(chunk); });
server.stderr.on("data", (chunk) => { output += String(chunk); });

try {
  let health;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`NestJS process stopped unexpectedly:\n${output}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // API process may still be starting.
    }
    await sleep(250);
  }

  assert.ok(health, `GET /api/health never responded:\n${output}`);
  assert.equal(health.service, "rcat-pos-api");
  assert.equal(health.productionReady, false);
  assert.equal(health.acceptingOrders, false);
  assert.equal(health.paymentEnabled, false);

  const readiness = await fetch(`${origin}/api/ready`);
  assert.equal(readiness.status, 503, "Readiness must fail until dependencies exist");

  console.log("NestJS API HTTP smoke passed: health 200, readiness 503");
} finally {
  server.kill("SIGTERM");
}
