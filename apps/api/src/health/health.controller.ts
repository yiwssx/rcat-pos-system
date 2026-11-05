import { Controller, Get, Header, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseAccess } from "../database/db-access";
import { foundationHealth } from "./health-status";

@Controller()
export class HealthController {
  constructor(private readonly database: DatabaseAccess) {}

  @Get("health")
  health() {
    // Liveness does NOT imply readiness, public availability or paid release.
    return foundationHealth();
  }

  @Get("ready")
  @Header("Cache-Control", "no-store")
  async readiness() {
    try {
      await this.database.readiness();
    } catch {
      // Never disclose connection strings, database schema or credentials.
      throw new ServiceUnavailableException({ status: "not_ready" });
    }
    // Staging/non-payment readiness only; NOT a production Go/No-Go signal.
    return {
      status: "ready",
      service: "rcat-pos-api",
      paymentEnabled: false,
      productionReady: false,
    };
  }
}
