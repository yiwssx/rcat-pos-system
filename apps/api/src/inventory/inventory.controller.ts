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
