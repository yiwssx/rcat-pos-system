import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "",
    pathMatch: "full",
    loadComponent: () => import("./home.page").then((m) => m.HomePage),
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
  { path: "**", redirectTo: "" },
];
