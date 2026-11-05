import { DOCUMENT } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  CatalogProducts,
  InventoryKind,
  InventorySnapshot,
  InventoryUnit,
  inventoryPath,
  StocktakeList,
} from "./inventory.domain";

@Injectable({ providedIn: "root" })
export class InventoryApi {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private csrf(): Record<string, string> {
    const matches = this.document.cookie
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.startsWith("__Host-rcat_csrf="));
    const token = matches[0]?.slice("__Host-rcat_csrf=".length);
    if (matches.length !== 1 || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error("ไม่พบ CSRF Token โปรดเข้าสู่ระบบใหม่");
    }
    return { "X-CSRF-Token": token };
  }

  snapshot(tenantId: string, storeId: string): Promise<InventorySnapshot> {
    return firstValueFrom(
      this.http.get<InventorySnapshot>(inventoryPath(tenantId, storeId), {
        withCredentials: true,
      }),
    );
  }

  catalog(tenantId: string, storeId: string): Promise<CatalogProducts> {
    return firstValueFrom(
      this.http.get<CatalogProducts>(
        "/api/tenants/" +
          encodeURIComponent(tenantId) +
          "/stores/" +
          encodeURIComponent(storeId) +
          "/catalog",
        { withCredentials: true },
      ),
    );
  }

  createItem(
    tenantId: string,
    storeId: string,
    name: string,
    unit: InventoryUnit,
    reorderAt: string,
  ): Promise<{ itemId: string }> {
    return firstValueFrom(
      this.http.post<{ itemId: string }>(
        inventoryPath(tenantId, storeId) + "/items",
        { name, unit, reorderAt },
        { headers: this.csrf(), withCredentials: true },
      ),
    );
  }

  move(
    tenantId: string,
    storeId: string,
    itemId: string,
    idempotencyKey: string,
    kind: InventoryKind,
    delta: string,
    reason: string,
  ): Promise<{
    movementId: string;
    itemId: string;
    onHand: string;
    replayed: boolean;
  }> {
    return firstValueFrom(
      this.http.post<{
        movementId: string;
        itemId: string;
        onHand: string;
        replayed: boolean;
      }>(
        inventoryPath(tenantId, storeId) + "/movements",
        { itemId, idempotencyKey, kind, delta, reason },
        { headers: this.csrf(), withCredentials: true },
      ),
    );
  }

  tracking(
    tenantId: string,
    storeId: string,
    productId: string,
    tracked: boolean,
  ): Promise<{ productId: string; tracked: boolean }> {
    return firstValueFrom(
      this.http.put<{ productId: string; tracked: boolean }>(
        inventoryPath(tenantId, storeId) +
          "/products/" +
          encodeURIComponent(productId) +
          "/tracking",
        { tracked },
        { headers: this.csrf(), withCredentials: true },
      ),
    );
  }

  modifierRecipe(
    tenantId: string,
    storeId: string,
    productId: string,
    groupId: string,
    optionId: string,
    itemId: string,
    quantityPerProduct: string,
  ): Promise<{ optionId: string; itemId: string; quantityPerProduct: string }> {
    return firstValueFrom(
      this.http.put<{
        optionId: string;
        itemId: string;
        quantityPerProduct: string;
      }>(
        inventoryPath(tenantId, storeId) +
          "/modifier-recipes/" +
          encodeURIComponent(productId) +
          "/groups/" +
          encodeURIComponent(groupId) +
          "/options/" +
          encodeURIComponent(optionId) +
          "/items/" +
          encodeURIComponent(itemId),
        { quantityPerProduct },
        { headers: this.csrf(), withCredentials: true },
      ),
    );
  }

  stocktakes(tenantId:string,storeId:string):Promise<StocktakeList> {
    return firstValueFrom(this.http.get<StocktakeList>(
      inventoryPath(tenantId,storeId)+"/stocktakes",
      {withCredentials:true},
    ));
  }

  openStocktake(tenantId:string,storeId:string,itemId:string,idempotencyKey:string) {
    return firstValueFrom(this.http.post<{
      stocktakeId:string;itemId:string;baselineOnHand:string;
      baselineVersion:string;state:string;replayed:boolean;
    }>(inventoryPath(tenantId,storeId)+"/stocktakes",
    {itemId,idempotencyKey},{headers:this.csrf(),withCredentials:true}));
  }

  submitStocktake(tenantId:string,storeId:string,stocktakeId:string,
    countedOnHand:string,reason:string) {
    return firstValueFrom(this.http.post<{
      stocktakeId:string;state:string;replayed:boolean;
    }>(inventoryPath(tenantId,storeId)+"/stocktakes/"+
      encodeURIComponent(stocktakeId)+"/count",
      {countedOnHand,reason},{headers:this.csrf(),withCredentials:true}));
  }

  reviewStocktake(tenantId:string,storeId:string,stocktakeId:string,
    approve:boolean) {
    return firstValueFrom(this.http.post<{
      stocktakeId:string;state:string;movementId:string|null;replayed:boolean;
    }>(inventoryPath(tenantId,storeId)+"/stocktakes/"+
      encodeURIComponent(stocktakeId)+"/review",
      {approve},{headers:this.csrf(),withCredentials:true}));
  }

  recipe(
    tenantId: string,
    storeId: string,
    productId: string,
    itemId: string,
    quantityPerProduct: string,
  ): Promise<{
    productId: string;
    itemId: string;
    quantityPerProduct: string;
  }> {
    return firstValueFrom(
      this.http.put<{
        productId: string;
        itemId: string;
        quantityPerProduct: string;
      }>(
        inventoryPath(tenantId, storeId) +
          "/recipes/" +
          encodeURIComponent(productId) +
          "/items/" +
          encodeURIComponent(itemId),
        { quantityPerProduct },
        { headers: this.csrf(), withCredentials: true },
      ),
    );
  }
}
