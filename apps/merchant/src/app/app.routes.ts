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
      import("./operational-reports.page").then((m) => m.OperationalReportsPage),
  },
  {
    path: "status",
    loadComponent: () => import("./status.page").then((m) => m.StatusPage),
  },
  { path: "**", redirectTo: "" },
];
