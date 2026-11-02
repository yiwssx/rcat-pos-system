export type OrderStatus = 'placed' | 'accepted' | 'preparing' | 'served' | 'completed' | 'cancelled';

export type DeferredPaymentStatus =
  | 'not_requested'
  | 'awaiting_payment'
  | 'pending_verification'
  | 'provider_verified'
  | 'manual_confirmed'
  | 'failed'
  | 'expired'
  | 'refunded';

export interface OrderIdentity {
  readonly id: string;
  readonly storeId: string;
  readonly tenantId: string;
  readonly totalSatang: number;
  readonly currency: 'THB';
  readonly paymentStatus: DeferredPaymentStatus;
}

export { parseThbToSatang } from './money';
