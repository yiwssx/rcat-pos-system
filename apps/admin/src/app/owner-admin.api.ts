import { DOCUMENT } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  AdminStore,
  MerchantCreation,
  StaffMember,
  InvitableRole,
  tenantAdminPath,
} from "./owner-admin.domain";

@Injectable({ providedIn: "root" })
export class OwnerAdminApi {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private csrfHeader(): Record<string, string> {
    const found = this.document.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("__Host-rcat_csrf="));
    if (found.length !== 1) {
      throw new Error("ไม่พบ CSRF Token กรุณาเข้าสู่ระบบด้วย Google อีกครั้ง");
    }
    const token = found[0]?.slice("__Host-rcat_csrf=".length);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error("CSRF Token ไม่ถูกต้อง กรุณาเข้าสู่ระบบอีกครั้ง");
    }
    return { "X-CSRF-Token": token };
  }

  stores(): Promise<{ stores: AdminStore[] }> {
    return firstValueFrom(this.http.get<{ stores: AdminStore[] }>(
      "/api/auth/merchant-stores", { withCredentials: true },
    ));
  }

  createMerchant(form: MerchantCreation): Promise<{
    tenantId: string;
    storeId: string;
    role: "owner";
  }> {
    return firstValueFrom(this.http.post<{
      tenantId: string;
      storeId: string;
      role: "owner";
    }>("/api/tenants", form, {
      headers: this.csrfHeader(), withCredentials: true,
    }));
  }

  staff(tenantId: string): Promise<{ tenantId: string; staff: StaffMember[] }> {
    return firstValueFrom(this.http.get<{
      tenantId: string;
      staff: StaffMember[];
    }>(tenantAdminPath(tenantId) + "/staff", {
      withCredentials: true,
    }));
  }

  invite(
    tenantId: string,
    email: string,
    role: InvitableRole,
  ): Promise<{ invitationId: string; invitationToken: string; expiresInHours: number }> {
    return firstValueFrom(this.http.post<{
      invitationId: string;
      invitationToken: string;
      expiresInHours: number;
    }>(tenantAdminPath(tenantId) + "/invitations", { email, role }, {
      headers: this.csrfHeader(), withCredentials: true,
    }));
  }

  accept(invitationToken: string): Promise<{
    tenantId: string;
    role: StaffMember["role"];
  }> {
    return firstValueFrom(this.http.post<{
      tenantId: string;
      role: StaffMember["role"];
    }>("/api/invitations/accept", { invitationToken }, {
      headers: this.csrfHeader(), withCredentials: true,
    }));
  }

  changeRole(
    tenantId: string,
    userId: string,
    role: InvitableRole,
  ): Promise<{ userId: string; role: StaffMember["role"] }> {
    return firstValueFrom(this.http.patch<{
      userId: string;
      role: StaffMember["role"];
    }>(tenantAdminPath(tenantId) + "/staff/" + encodeURIComponent(userId),
    { role }, { headers: this.csrfHeader(), withCredentials: true }));
  }

  removeStaff(tenantId: string, userId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(
      tenantAdminPath(tenantId) + "/staff/" + encodeURIComponent(userId),
      { headers: this.csrfHeader(), withCredentials: true },
    ));
  }

  logout(): Promise<void> {
    return firstValueFrom(this.http.post<void>("/api/auth/logout", {}, {
      headers: this.csrfHeader(), withCredentials: true,
    }));
  }
}
