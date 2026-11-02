import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { DatabaseAccess } from "./database/db-access";
import { AuthController, TenantStoreController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { MerchantOnboardingController } from "./merchant/merchant-onboarding.controller";
import { MerchantOnboardingService } from "./merchant/merchant-onboarding.service";

@Module({
  controllers: [
    HealthController,
    AuthController,
    TenantStoreController,
    MerchantOnboardingController,
  ],
  providers: [DatabaseAccess, AuthService, MerchantOnboardingService],
})
export class AppModule {}
