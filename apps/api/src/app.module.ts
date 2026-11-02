import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { DatabaseAccess } from "./database/db-access";
import { AuthController, TenantStoreController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { EmailDeliveryService } from "./auth/email-delivery.service";
import { PasswordRecoveryService } from "./auth/password-recovery.service";
import { PasswordRecoveryController } from "./auth/password-recovery.controller";
import { EmailRegistrationController } from "./auth/email-registration.controller";
import { EmailRegistrationService } from "./auth/email-registration.service";
import { MerchantOnboardingController } from "./merchant/merchant-onboarding.controller";
import { MerchantOnboardingService } from "./merchant/merchant-onboarding.service";
import { StaffAdministrationController } from "./merchant/staff-administration.controller";
import { StaffAdministrationService } from "./merchant/staff-administration.service";

@Module({
  controllers: [
    HealthController,
    AuthController,
    EmailRegistrationController,
    PasswordRecoveryController,
    TenantStoreController,
    MerchantOnboardingController,
    StaffAdministrationController,
  ],
  providers: [
    DatabaseAccess,
    AuthService,
    EmailRegistrationService,
    PasswordRecoveryService,
    EmailDeliveryService,
    MerchantOnboardingService,
    StaffAdministrationService,
  ],
})
export class AppModule {}
