import { DOCUMENT } from "@angular/common";
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from "@angular/common/http";
import { Injectable, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import type { MerchantStore } from "../../../merchant/src/app/order-board.domain";

@Injectable({ providedIn: "root" })
export class PortalSession {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  readonly phase = signal<"loading" | "guest" | "staff" | "error">("loading");
  readonly stores = signal<MerchantStore[]>([]);
  readonly platformRole = signal<"super_admin" | "admin" | "merchant" | null>(
    null,
  );
  readonly notice = signal("");
  private pending: Promise<void> | undefined;
  private generation = 0;

  ensure(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.phase() !== "loading") return Promise.resolve();
    return this.refresh();
  }

  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    const generation = ++this.generation;
    this.phase.set("loading");
    this.stores.set([]);
    this.platformRole.set(null);
    this.pending = (async () => {
      try {
        const identity = await firstValueFrom(
          this.http.get<{
            platformRole?: "super_admin" | "admin" | "merchant" | null;
          }>("/api/auth/me"),
        );
        const data = await firstValueFrom(
          this.http.get<{ stores: MerchantStore[] }>(
            "/api/auth/merchant-stores",
          ),
        );
        if (generation !== this.generation) return;
        this.stores.set(data.stores);
        this.platformRole.set(identity.platformRole ?? null);
        this.phase.set("staff");
        this.notice.set("");
      } catch (error) {
        if (generation !== this.generation) return;
        this.stores.set([]);
        this.platformRole.set(null);
        this.phase.set(
          error instanceof HttpErrorResponse && error.status === 401
            ? "guest"
            : "error",
        );
      } finally {
        if (generation === this.generation) this.pending = undefined;
      }
    })();
    return this.pending;
  }

  expire(): void {
    ++this.generation;
    this.pending = undefined;
    this.stores.set([]);
    this.platformRole.set(null);
    this.phase.set("guest");
    this.notice.set("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
  }

  async logout(): Promise<void> {
    const token =
      this.document.cookie
        .split("; ")
        .find((value) => value.startsWith("__Host-rcat_csrf="))
        ?.split("=")[1] ?? "";
    await firstValueFrom(
      this.http.post(
        "/api/auth/logout",
        {},
        { headers: new HttpHeaders({ "X-CSRF-Token": token }) },
      ),
    );
    this.expire();
    this.notice.set("ออกจากระบบแล้ว");
  }
}
