import { EnvironmentInjector, inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { permitsRoute } from "./portal-permissions";

export const portalAccess: CanActivateFn = (route) => {
  const injector = inject(EnvironmentInjector);
  const router = inject(Router);
  return import("./portal-session.service").then(async ({ PortalSession }) => {
    const session = injector.get(PortalSession);
    await session.ensure();
    const permission = String(route.data["permission"]);
    const platformAdmin =
      session.platformRole() === "super_admin" ||
      session.platformRole() === "admin";
    const allowed =
      session.phase() === "staff" &&
      (permission === "platform"
        ? platformAdmin
        : permission === "settings"
          ? platformAdmin ||
            session.stores().some((store) => store.role === "owner")
          : permitsRoute(
              session.stores(),
              permission,
              route.paramMap.get("tenantId") ?? undefined,
              route.paramMap.get("storeId") ?? undefined,
            ));
    if (allowed) return true;
    if (session.phase() === "staff")
      session.notice.set("บัญชีนี้ไม่มีสิทธิ์เข้าถึงงานหรือร้านที่เลือก");
    return router.createUrlTree(["/"]);
  });
};
