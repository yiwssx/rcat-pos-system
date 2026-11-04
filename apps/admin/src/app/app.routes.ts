import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "",
    pathMatch: "full",
    loadComponent: () => import("./home.page").then((m) => m.HomePage),
  },
  {
    path: "tenants/:tenantId/staff",
    loadComponent: () => import("./staff.page").then((m) => m.StaffPage),
  },
  {
    path: "status",
    loadComponent: () => import("./status.page").then((m) => m.StatusPage),
  },
  { path: "**", redirectTo: "" },
];
