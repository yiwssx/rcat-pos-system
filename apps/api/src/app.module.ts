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
import { CatalogController } from "./catalog/catalog.controller";
import { CatalogService } from "./catalog/catalog.service";
import { TableOrderingController } from "./ordering/table-ordering.controller";
import { TableOrderingService } from "./ordering/table-ordering.service";
import { ProductModifiersController } from "./catalog/product-modifiers.controller";
import { ProductModifiersService } from "./catalog/product-modifiers.service";
import { GuestOrdersController } from "./orders/guest-orders.controller";
import { GuestOrdersService } from "./orders/guest-orders.service";
import { MerchantOrdersController } from "./orders/merchant-orders.controller";
import { MerchantOrdersService } from "./orders/merchant-orders.service";
import { OperationalBillsController } from "./orders/operational-bills.controller";
import { OperationalBillsService } from "./orders/operational-bills.service";
import { MerchantNotificationsController } from "./orders/merchant-notifications.controller";
import { MerchantNotificationsService } from "./orders/merchant-notifications.service";
import { MerchantNotificationStreamService } from "./orders/merchant-notification-stream.service";

@Module({
  controllers: [
    HealthController,
    AuthController,
    EmailRegistrationController,
    PasswordRecoveryController,
    TenantStoreController,
    MerchantOnboardingController,
    StaffAdministrationController,
    CatalogController,
    TableOrderingController,
    ProductModifiersController,
    GuestOrdersController,
    MerchantOrdersController,
    OperationalBillsController,
    MerchantNotificationsController,
  ],
  providers: [
    DatabaseAccess,
    AuthService,
    EmailRegistrationService,
    PasswordRecoveryService,
    EmailDeliveryService,
    MerchantOnboardingService,
    StaffAdministrationService,
    CatalogService,
    TableOrderingService,
    ProductModifiersService,
    GuestOrdersService,
    MerchantOrdersService,
    OperationalBillsService,
    MerchantNotificationsService,
    MerchantNotificationStreamService,
  ],
})
export class AppModule {}
