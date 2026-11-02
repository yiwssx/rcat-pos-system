export interface FoundationHealth {
  readonly service: "rcat-pos-api";
  readonly phase: "G1-foundation";
  readonly healthy: true;
  readonly productionReady: false;
  readonly acceptingOrders: false;
  readonly paymentEnabled: false;
}

export function foundationHealth(): FoundationHealth {
  return {
    service: "rcat-pos-api",
    phase: "G1-foundation",
    healthy: true,
    productionReady: false,
    acceptingOrders: false,
    paymentEnabled: false,
  };
}
