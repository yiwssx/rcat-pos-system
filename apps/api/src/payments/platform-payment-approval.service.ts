import { Injectable } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { DatabaseAccess } from "../database/db-access";
import { PlatformPaymentApprovalCore } from "./platform-payment-approval.core";

@Injectable()
export class PlatformPaymentApprovalService extends PlatformPaymentApprovalCore {
  constructor(auth: AuthService, database: DatabaseAccess) {
    super(auth, database);
  }
}
