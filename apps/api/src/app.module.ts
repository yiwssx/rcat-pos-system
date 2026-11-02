import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { DatabaseAccess } from "./database/db-access";
import { AuthController, TenantStoreController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { EmailRegistrationController } from "./auth/email-registration.controller";
import { EmailRegistrationService } from "./auth/email-registration.service";
import { MerchantOnboardingController } from "./merchant/merchant-onboarding.controller";
import { MerchantOnboardingService } from "./merchant/merchant-onboarding.service";

@Module({
  controllers: [
    HealthController,
    AuthController,
    EmailRegistrationController,
    TenantStoreController,
    MerchantOnboardingController,
  ],
  providers: [
    DatabaseAccess,
    AuthService,
    EmailRegistrationService,
    MerchantOnboardingService,
  ],
})
export class AppModule {}
