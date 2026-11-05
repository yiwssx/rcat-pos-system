import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "",
    pathMatch: "full",
    loadComponent: () => import("./home.page").then((m) => m.HomePage),
  },
  {
    path: "orders/:tenantId/:storeId",
    loadComponent: () =>
      import("./order-board.page").then((m) => m.MerchantOrderBoardPage),
  },
  {
    path: "reports/:tenantId/:storeId",
    loadComponent: () =>
      import("./operational-reports.page").then(
        (m) => m.OperationalReportsPage,
      ),
  },
  {
    path: "inventory/:tenantId/:storeId/exception-returns/:orderId",
    loadComponent: () =>
      import("./exception-returns.page").then((m) => m.ExceptionReturnsPage),
  },
  {
    path: "inventory/:tenantId/:storeId/stocktakes",
    loadComponent: () =>
      import("./stocktake.page").then((m) => m.StocktakePage),
  },
  {
    path: "inventory/:tenantId/:storeId",
    loadComponent: () =>
      import("./inventory.page").then((m) => m.InventoryPage),
  },
  {
    path: "status",
    loadComponent: () => import("./status.page").then((m) => m.StatusPage),
  },
  { path: "**", redirectTo: "" },
];
