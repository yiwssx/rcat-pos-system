import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { provideHttpClient } from "@angular/common/http";
import { AppComponent } from "./app/app.component";
import { routes } from "./app/app.routes";

bootstrapApplication(AppComponent, {
  providers: [provideRouter(routes), provideHttpClient()],
}).catch((error: unknown) =>
  console.error("Unable to start RCAT POS application", error),
);

if (
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  (location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1")
) {
  window.addEventListener(
    "load",
    () => {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          // PWA caching is optional. The live Order Board and secure HTTP
          // fallback must continue working when SW installation fails.
        });
    },
    { once: true },
  );
}
