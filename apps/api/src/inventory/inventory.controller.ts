import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { InventoryService } from "./inventory.service";

@Controller("tenants/:tenantId/stores/:storeId/inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  snapshot(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
  ) {
    return this.inventory.snapshot(req, tenantId, storeId);
  }

  @Get("stocktakes")
  @Header("Cache-Control", "no-store")
  stocktakes(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
  ) {
    return this.inventory.stocktakes(req, tenantId, storeId);
  }

  @Post("stocktakes")
  @Header("Cache-Control", "no-store")
  openStocktake(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.inventory.openStocktake(req, tenantId, storeId, body);
  }

  @Post("stocktakes/:stocktakeId/count")
  @Header("Cache-Control", "no-store")
  submitStocktake(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("stocktakeId") stocktakeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.inventory.submitStocktake(
      req,
      tenantId,
      storeId,
      stocktakeId,
      body,
    );
  }

  @Post("stocktakes/:stocktakeId/review")
  @Header("Cache-Control", "no-store")
  reviewStocktake(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("stocktakeId") stocktakeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.inventory.reviewStocktake(
      req,
      tenantId,
      storeId,
      stocktakeId,
      body,
    );
  }

  @Post("items")
  @Header("Cache-Control", "no-store")
  createItem(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.inventory.createItem(req, tenantId, storeId, body);
  }

  @Post("movements")
  @Header("Cache-Control", "no-store")
  movement(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.inventory.movement(req, tenantId, storeId, body);
  }

  @Put("products/:productId/tracking")
  @Header("Cache-Control", "no-store")
  tracking(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.inventory.tracking(req, tenantId, storeId, productId, body);
  }

  @Put(
    "modifier-recipes/:productId/groups/:groupId/options/:optionId/items/:itemId",
  )
  @Header("Cache-Control", "no-store")
  modifierRecipe(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Param("groupId") groupId: string,
    @Param("optionId") optionId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.inventory.modifierRecipe(
      req,
      tenantId,
      storeId,
      productId,
      groupId,
      optionId,
      itemId,
      body,
    );
  }

  @Put("recipes/:productId/items/:itemId")
  @Header("Cache-Control", "no-store")
  setRecipe(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.inventory.setRecipe(
      req,
      tenantId,
      storeId,
      productId,
      itemId,
      body,
    );
  }
}
