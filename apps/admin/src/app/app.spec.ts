import { describe, expect, it } from "vitest";
import { routes } from "./app.routes";
import {
  canManageStaff,
  normalizeStaffEmail,
  shortStaffId,
  tenantAdminPath,
  validInvitationToken,
  validInviteRole,
  validMerchantCreation,
  validScopeId,
} from "./owner-admin.domain";

describe("Admin tenant-owner routing and validation", () => {
  it("loads account onboarding and tenant-scoped staff UI lazily, without payment", () => {
    expect(routes[0]?.path).toBe("");
    expect(
      routes.find((route) => route.path === "tenants/:tenantId/staff")
        ?.loadComponent,
    ).toBeTypeOf("function");
    expect(
      routes.find((route) => route.path === "status")?.loadComponent,
    ).toBeTypeOf("function");
    expect(routes.some((route) => route.path?.includes("payment"))).toBe(false);
  });

  it("never treats merchant manager/cashier/kitchen as owner authority", () => {
    expect(canManageStaff("owner")).toBe(true);
    expect(canManageStaff("manager")).toBe(false);
    expect(canManageStaff("cashier")).toBe(false);
    expect(canManageStaff("kitchen")).toBe(false);
  });

  it("validates owner onboarding slugs/names against server constraints", () => {
    const form = {
      tenantSlug: "rcat-demo",
      tenantName: "วิทยาลัยร้อยเอ็ด",
      storeSlug: "canteen-1",
      storeName: "ร้านอาหาร",
    };
    expect(validMerchantCreation(form)).toBe(null);
    expect(validMerchantCreation({ ...form, tenantSlug: "../evil" })).not.toBe(
      null,
    );
    expect(validMerchantCreation({ ...form, storeSlug: "UPPERCASE" })).not.toBe(
      null,
    );
    expect(validMerchantCreation({ ...form, tenantSlug: "a" })).not.toBe(null);
    expect(
      validMerchantCreation({ ...form, tenantName: " ".repeat(10) }),
    ).not.toBe(null);
    expect(
      validMerchantCreation({ ...form, storeName: "a".repeat(161) }),
    ).not.toBe(null);
  });

  it("accepts only RCAT email in the invitation UI and never grants owner via invite", () => {
    expect(normalizeStaffEmail("  STAFF@RCAT.AC.TH  ")).toBe(
      "staff@rcat.ac.th",
    );
    for (const email of [
      "someone@gmail.com",
      "staff@rcat.ac.th.evil.test",
      "staff@not-rcat.ac.th",
      "staff@rcat.ac.th@evil.test",
      "staff@example.org",
      "",
    ]) {
      expect(normalizeStaffEmail(email)).toBe(null);
    }
    expect(validInviteRole("manager")).toBe(true);
    expect(validInviteRole("cashier")).toBe(true);
    expect(validInviteRole("kitchen")).toBe(true);
    expect(validInviteRole("owner")).toBe(false);
  });

  it("requires exact opaque invitation tokens and tenant IDs", () => {
    expect(validInvitationToken("s".repeat(43))).toBe(true);
    expect(validInvitationToken("x".repeat(42))).toBe(false);
    expect(validInvitationToken("x".repeat(43) + "?")).toBe(false);
    expect(validInvitationToken("../random")).toBe(false);
    expect(validScopeId("10000000-0000-4000-8000-000000000001")).toBe(true);
    expect(validScopeId("../path")).toBe(false);
    expect(tenantAdminPath("tenant?A")).toBe("/api/tenants/tenant%3FA");
    expect(tenantAdminPath("../other")).not.toContain("/../");
    expect(shortStaffId("bad")).toBe("—");
  });
});
