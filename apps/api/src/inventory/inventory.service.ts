import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { AuthService } from "../auth/auth.service";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";
import {
  InventorySnapshot,
  validInventoryId,
  validateItem,
  validateMovement,
  validRecipeQuantity,
} from "./inventory.core";

function mapInventoryError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : null;
  if (code === "42501" || code === "28000" || code === "23503") {
    throw new NotFoundException("Inventory unavailable");
  }
  if (code === "23505")
    throw new ConflictException("Inventory record or retry key already used");
  if (
    code === "22023" ||
    code === "23514" ||
    code === "22P02" ||
    code === "22003"
  ) {
    throw new BadRequestException(
      "Invalid quantity, item or insufficient stock",
    );
  }
  throw error;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  private checkScope(tenantId: string, storeId: string): void {
    if (!validInventoryId(tenantId) || !validInventoryId(storeId)) {
      throw new NotFoundException("Inventory unavailable");
    }
  }

  async snapshot(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
  ): Promise<InventorySnapshot> {
    this.checkScope(tenantId, storeId);
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ snapshot: InventorySnapshot }>(
          "SELECT rcat_private.inventory_snapshot($1,$2,$3) AS snapshot",
          [digestOpaqueSecret(session.token), tenantId, storeId],
        ),
      );
      const record = result.rows[0]?.snapshot;
      if (
        !record ||
        record.stockMode !== "manual_ledger_only" ||
        record.orderConsumptionEnabled !== false
      ) {
        throw new Error("Unexpected inventory snapshot");
      }
      return record;
    } catch (error) {
      mapInventoryError(error);
    }
  }

  async createItem(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    this.checkScope(tenantId, storeId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const item = validateItem(raw);
    if (!item) throw new BadRequestException("Invalid inventory item");
    try {
      const result = await this.database.auth((client) =>
        client.query<{ item_id: string }>(
          "SELECT rcat_private.inventory_create_item($1,$2,$3,$4,$5,$6::numeric) AS item_id",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            item.name,
            item.unit,
            item.reorderAt,
          ],
        ),
      );
      return { itemId: result.rows[0]?.item_id };
    } catch (error) {
      mapInventoryError(error);
    }
  }

  async movement(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    this.checkScope(tenantId, storeId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const movement = validateMovement(raw);
    if (!movement) throw new BadRequestException("Invalid inventory movement");
    try {
      const result = await this.database.auth((client) =>
        client.query<{
          movement: {
            movementId: string;
            itemId: string;
            onHand: string;
            replayed: boolean;
          };
        }>(
          "SELECT rcat_private.inventory_move($1,$2,$3,$4,$5,$6,$7::numeric,$8) AS movement",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            movement.itemId,
            movement.idempotencyKey,
            movement.kind,
            movement.delta,
            movement.reason,
          ],
        ),
      );
      return result.rows[0]?.movement;
    } catch (error) {
      mapInventoryError(error);
    }
  }

  async setRecipe(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    productId: string,
    itemId: string,
    raw: unknown,
  ) {
    this.checkScope(tenantId, storeId);
    if (!validInventoryId(productId) || !validInventoryId(itemId)) {
      throw new NotFoundException("Recipe unavailable");
    }
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const quantity = data["quantityPerProduct"];
    if (!validRecipeQuantity(quantity)) {
      throw new BadRequestException("Invalid recipe quantity");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{
          recipe: {
            productId: string;
            itemId: string;
            quantityPerProduct: string;
          };
        }>(
          "SELECT rcat_private.inventory_set_recipe($1,$2,$3,$4,$5,$6::numeric) AS recipe",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            productId,
            itemId,
            quantity,
          ],
        ),
      );
      return result.rows[0]?.recipe;
    } catch (error) {
      mapInventoryError(error);
    }
  }
}
