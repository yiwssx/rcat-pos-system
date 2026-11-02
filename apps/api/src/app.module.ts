import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { DatabaseAccess } from "./database/db-access";
import { AuthController, TenantStoreController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";

@Module({
  controllers: [HealthController, AuthController, TenantStoreController],
  providers: [DatabaseAccess, AuthService],
})
export class AppModule {}
