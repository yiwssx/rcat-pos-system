import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { CatalogService } from "./catalog.service";

@Controller("tenants/:tenantId/stores/:storeId/catalog")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  snapshot(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
  ) {
    return this.catalog.snapshot(req, tenantId, storeId);
  }

  @Get("products/page")
  @Header("Cache-Control", "no-store")
  page(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Query() query: unknown,
  ) {
    return this.catalog.page(req, tenantId, storeId, query);
  }

  @Post("categories")
  @Header("Cache-Control", "no-store")
  addCategory(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.catalog.addCategory(req, tenantId, storeId, body);
  }

  @Post("products")
  @Header("Cache-Control", "no-store")
  addProduct(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.catalog.addProduct(req, tenantId, storeId, body);
  }

  @Patch("products/:productId")
  @Header("Cache-Control", "no-store")
  updateProduct(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.catalog.updateProduct(req, tenantId, storeId, productId, body);
  }

  @Post("products/:productId/archive")
  @Header("Cache-Control", "no-store")
  archiveProduct(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.catalog.archiveProduct(req, tenantId, storeId, productId, body);
  }

  @Patch("products/:productId/availability")
  @Header("Cache-Control", "no-store")
  availability(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.catalog.availability(req, tenantId, storeId, productId, body);
  }
}
