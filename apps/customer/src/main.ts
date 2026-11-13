import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { portalSessionErrors } from "./app/app.component";
import { AppComponent } from "./app/app.component";
import { routes } from "./app/app.routes";

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([portalSessionErrors])),
  ],
}).catch((error: unknown) =>
  console.error("Unable to start RCAT POS application", error),
);

// Static assets only; API/HTML and order mutations are never cached.
if (
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  location.protocol === "https:"
) {
  window.addEventListener(
    "load",
    () => {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {});
    },
    { once: true },
  );
}
