import { DOCUMENT } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

export interface CatalogCategory {
  id: string;
  slug: string;
  name: string;
}

export interface CatalogProduct {
  id: string;
  categoryId: string;
  name: string;
  priceSatang: number;
  available: boolean;
  revision: number;
  archivedAt: string | null;
  hasImage: boolean;
}

export interface MerchantCatalogSnapshot {
  categories: CatalogCategory[];
  products: CatalogProduct[];
}

export interface CatalogEdit {
  expectedRevision: number;
  name: string;
  categoryId: string;
  priceSatang: number;
}

function scope(tenantId: string, storeId: string): string {
  return (
    "/api/tenants/" +
    encodeURIComponent(tenantId) +
    "/stores/" +
    encodeURIComponent(storeId) +
    "/catalog"
  );
}

@Injectable({ providedIn: "root" })
export class MerchantCatalogApi {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private csrfHeaders(): { "X-CSRF-Token": string } {
    const matches = this.document.cookie
      .split(";")
      .map((value) => value.trim())
      .filter((value) => value.startsWith("__Host-rcat_csrf="));
    const token = matches[0]?.slice("__Host-rcat_csrf=".length);
    if (matches.length !== 1 || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error("กรุณาเข้าสู่ระบบอีกครั้งเพื่อบันทึกข้อมูล");
    }
    return { "X-CSRF-Token": token };
  }

  snapshot(
    tenantId: string,
    storeId: string,
  ): Promise<MerchantCatalogSnapshot> {
    return firstValueFrom(
      this.http.get<MerchantCatalogSnapshot>(scope(tenantId, storeId), {
        withCredentials: true,
      }),
    );
  }

  createCategory(
    tenantId: string,
    storeId: string,
    name: string,
    slug: string,
  ): Promise<{ categoryId: string }> {
    return firstValueFrom(
      this.http.post<{ categoryId: string }>(
        scope(tenantId, storeId) + "/categories",
        { name, slug },
        {
          headers: this.csrfHeaders(),
          withCredentials: true,
        },
      ),
    );
  }

  createProduct(
    tenantId: string,
    storeId: string,
    name: string,
    categoryId: string,
    priceSatang: number,
  ): Promise<{ productId: string }> {
    return firstValueFrom(
      this.http.post<{ productId: string }>(
        scope(tenantId, storeId) + "/products",
        { name, categoryId, priceSatang },
        {
          headers: this.csrfHeaders(),
          withCredentials: true,
        },
      ),
    );
  }

  editProduct(
    tenantId: string,
    storeId: string,
    productId: string,
    values: CatalogEdit,
  ): Promise<{ productId: string; revision: number; changed: boolean }> {
    return firstValueFrom(
      this.http.patch<{
        productId: string;
        revision: number;
        changed: boolean;
      }>(
        scope(tenantId, storeId) + "/products/" + encodeURIComponent(productId),
        values,
        { headers: this.csrfHeaders(), withCredentials: true },
      ),
    );
  }

  archiveProduct(
    tenantId: string,
    storeId: string,
    productId: string,
    expectedRevision: number,
  ): Promise<{ productId: string; archived: true }> {
    return firstValueFrom(
      this.http.post<{ productId: string; archived: true }>(
        scope(tenantId, storeId) +
          "/products/" +
          encodeURIComponent(productId) +
          "/archive",
        { expectedRevision },
        { headers: this.csrfHeaders(), withCredentials: true },
      ),
    );
  }

  productImageUrl(tenantId: string, storeId: string, productId: string, revision: number): string {
    return scope(tenantId, storeId) +
      "/products/" + encodeURIComponent(productId) + "/image?v=" +
      encodeURIComponent(String(revision));
  }

  uploadImage(
    tenantId: string, storeId: string, productId: string,
    revision: number, image: Blob,
  ): Promise<{ revision: number; hasImage: boolean }> {
    return firstValueFrom(
      this.http.put<{ revision: number; hasImage: boolean }>(
        scope(tenantId, storeId) + "/products/" + encodeURIComponent(productId) + "/image",
        image,
        { headers: { ...this.csrfHeaders(), "X-Expected-Revision": String(revision),
            "Content-Type": "image/webp" }, withCredentials: true },
      ),
    );
  }

  deleteImage(
    tenantId: string, storeId: string, productId: string, revision: number,
  ): Promise<{ revision: number; hasImage: boolean }> {
    return firstValueFrom(
      this.http.delete<{ revision: number; hasImage: boolean }>(
        scope(tenantId, storeId) + "/products/" + encodeURIComponent(productId) + "/image",
        { headers: { ...this.csrfHeaders(), "X-Expected-Revision": String(revision) },
          withCredentials: true },
      ),
    );
  }

  availability(
    tenantId: string,
    storeId: string,
    productId: string,
    available: boolean,
  ): Promise<{ available: boolean }> {
    return firstValueFrom(
      this.http.patch<{ available: boolean }>(
        scope(tenantId, storeId) +
          "/products/" +
          encodeURIComponent(productId) +
          "/availability",
        { available },
        { headers: this.csrfHeaders(), withCredentials: true },
      ),
    );
  }
}
