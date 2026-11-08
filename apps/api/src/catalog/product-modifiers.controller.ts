import {
  Body,
  Controller,
  Header,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { ProductModifiersService } from "./product-modifiers.service";

@Controller(
  "tenants/:tenantId/stores/:storeId/catalog/products/:productId/modifier-groups",
)
export class ProductModifiersController {
  constructor(private readonly modifiers: ProductModifiersService) {}

  @Post()
  @Header("Cache-Control", "no-store")
  addGroup(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.modifiers.addGroup(req, tenantId, storeId, productId, body);
  }

  @Post(":groupId/options")
  @Header("Cache-Control", "no-store")
  addOption(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Param("groupId") groupId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.modifiers.addOption(
      req,
      tenantId,
      storeId,
      productId,
      groupId,
      body,
    );
  }

  @Patch(":groupId")
  @Header("Cache-Control", "no-store")
  updateGroup(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Param("groupId") groupId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.modifiers.updateGroup(
      req,
      tenantId,
      storeId,
      productId,
      groupId,
      body,
    );
  }

  @Patch(":groupId/options/:optionId")
  @Header("Cache-Control", "no-store")
  updateOption(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Param("groupId") groupId: string,
    @Param("optionId") optionId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.modifiers.updateOption(
      req,
      tenantId,
      storeId,
      productId,
      groupId,
      optionId,
      body,
    );
  }

  @Patch(":groupId/options/:optionId/availability")
  @Header("Cache-Control", "no-store")
  availability(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Param("groupId") groupId: string,
    @Param("optionId") optionId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.modifiers.availability(
      req,
      tenantId,
      storeId,
      productId,
      groupId,
      optionId,
      body,
    );
  }
}
