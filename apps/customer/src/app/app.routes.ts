import { Routes } from "@angular/router";
import { portalAccess } from "./portal-access";

export const routes: Routes = [
  {
    path: "",
    pathMatch: "full",
    loadComponent: () =>
      import("./portal-home.page").then((m) => m.PortalHomePage),
  },
  {
    path: "order",
    pathMatch: "full",
    loadComponent: () =>
      import("./guest-order.page").then((m) => m.GuestOrderPage),
  },
  {
    path: "order/track",
    pathMatch: "full",
    loadComponent: () =>
      import("./guest-track.page").then((m) => m.GuestTrackPage),
  },
  {
    path: "status",
    loadComponent: () => import("./status.page").then((m) => m.StatusPage),
  },
  {
    path: "orders/:tenantId/:storeId",
    canActivate: [portalAccess],
    data: { permission: "orders" },
    loadComponent: () =>
      import("../../../merchant/src/app/order-board.page").then(
        (m) => m.MerchantOrderBoardPage,
      ),
  },
  {
    path: "tables/:tenantId/:storeId",
    canActivate: [portalAccess],
    data: { permission: "tables" },
    loadComponent: () =>
      import("../../../merchant/src/app/merchant-tables.page").then(
        (m) => m.MerchantTablesPage,
      ),
  },
  {
    path: "catalog/:tenantId/:storeId",
    canActivate: [portalAccess],
    data: { permission: "catalog" },
    loadComponent: () =>
      import("../../../merchant/src/app/merchant-catalog.page").then(
        (m) => m.MerchantCatalogPage,
      ),
  },
  {
    path: "reports/:tenantId/:storeId",
    canActivate: [portalAccess],
    data: { permission: "reports" },
    loadComponent: () =>
      import("../../../merchant/src/app/operational-reports.page").then(
        (m) => m.OperationalReportsPage,
      ),
  },
  {
    path: "inventory/:tenantId/:storeId/exception-returns/:orderId",
    canActivate: [portalAccess],
    data: { permission: "inventory" },
    loadComponent: () =>
      import("../../../merchant/src/app/exception-returns.page").then(
        (m) => m.ExceptionReturnsPage,
      ),
  },
  {
    path: "inventory/:tenantId/:storeId/stocktakes",
    canActivate: [portalAccess],
    data: { permission: "inventory" },
    loadComponent: () =>
      import("../../../merchant/src/app/stocktake.page").then(
        (m) => m.StocktakePage,
      ),
  },
  {
    path: "inventory/:tenantId/:storeId",
    canActivate: [portalAccess],
    data: { permission: "inventory" },
    loadComponent: () =>
      import("../../../merchant/src/app/inventory.page").then(
        (m) => m.InventoryPage,
      ),
  },
  {
    path: "settings",
    canActivate: [portalAccess],
    data: { permission: "settings", unified: true },
    loadComponent: () =>
      import("../../../admin/src/app/home.page").then((m) => m.HomePage),
  },
  {
    path: "tenants/:tenantId/staff",
    canActivate: [portalAccess],
    data: { permission: "staff" },
    loadComponent: () =>
      import("../../../admin/src/app/staff.page").then((m) => m.StaffPage),
  },
  { path: "**", redirectTo: "" },
];
