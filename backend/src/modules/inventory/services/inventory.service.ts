/**
 * Inventory service — all business rules for stock items. Depends on the
 * repository contract, throws application errors, never touches HTTP.
 *
 * Body handling replicates the legacy coercions exactly: String()/Number()
 * semantics that never reject (invalid numbers fall back to 0/null, invalid
 * dates flow to Prisma as Invalid Date), the 404 firing before any body
 * processing, and the bare "name is required" message.
 */
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/session";
import { nextInventoryItemCode } from "@/lib/codes";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { Session } from "@/lib/session";
import type { InventoryItem } from "@prisma/client";
import type {
  InventoryItemDetailRow,
  InventoryItemUpdateData,
  InventoryRepository,
} from "../repositories/inventory.repository.interface";

const log = logger.child("inventory");

function addQuantityLog(v: unknown): string {
  const n = Math.trunc(Number(v) || 0);
  return n >= 0 ? `+${n}` : `${n}`;
}

export class InventoryService {
  constructor(private readonly inventoryRepository: InventoryRepository) {}

  /** GET /api/inventory?category=&q=&low=1 (auth) — orderBy name. */
  async list(filters: { category?: string; q?: string; low: boolean }): Promise<InventoryItem[]> {
    const items = await this.inventoryRepository.listItems(filters);

    // SQLite cannot reference another column in `where` — filter in memory
    return filters.low ? items.filter((i) => i.quantity <= i.minStock) : items;
  }

  /** POST /api/inventory (ADMIN | VOLUNTEER) — {name, category?, quantity?, ...}. */
  async create(body: Record<string, unknown>, actor: Session): Promise<InventoryItem> {
    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("name is required", 400);
    const category = String(body.category ?? "").trim().toUpperCase() || "OTHER";
    const quantity = Math.max(0, Math.trunc(Number(body.quantity ?? 0)) || 0);

    const item = await this.inventoryRepository.createItem({
      code: await nextInventoryItemCode(),
      name,
      category,
      quantity,
      unit: body.unit ? String(body.unit).trim() : "piece",
      minStock: Math.max(0, Math.trunc(Number(body.minStock ?? 10)) || 0),
      location: body.location ? String(body.location).trim() : null,
      pricePerUnit:
        body.pricePerUnit !== undefined &&
        body.pricePerUnit !== null &&
        body.pricePerUnit !== "" &&
        Number.isFinite(Number(body.pricePerUnit))
          ? Number(body.pricePerUnit)
          : null,
      description: body.description ? String(body.description) : null,
      expiryDate: body.expiryDate ? new Date(String(body.expiryDate)) : null,
    });

    log.info("inventory_item_created", {
      itemId: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "STOCK_ADD",
      "InventoryItem",
      `${name} (${category}) ×${quantity}`,
      actor.userId
    );
    return item;
  }

  /** GET /api/inventory/:id — item + purchase history (ADMIN | VOLUNTEER). */
  async getById(id: string): Promise<InventoryItemDetailRow & { usedTotal: number }> {
    const item = await this.inventoryRepository.findItemDetail(id);
    if (!item) throw new NotFoundError("Inventory item not found");
    const usedTotal = await this.inventoryRepository.sumDistributedQuantity(id);
    return { ...item, usedTotal: usedTotal ?? 0 };
  }

  /**
   * PATCH /api/inventory/:id (ADMIN | VOLUNTEER)
   *   {addQuantity} → increment quantity (never below 0)
   *   ...or set plain fields {name?, category?, quantity?, minStock?, unit?,
   *       location?, pricePerUnit?, description?}
   * Stock-in with supplier details also records an InventoryPurchase row.
   */
  async update(id: string, body: Record<string, unknown>, actor: Session): Promise<InventoryItem> {
    const existing = await this.inventoryRepository.findItem(id);
    if (!existing) {
      log.warn("inventory_item_update_not_found", { itemId: id, actor: actor.userId });
      throw new NotFoundError("Inventory item not found");
    }

    const data: InventoryItemUpdateData = {};

    if (body.addQuantity !== undefined) {
      const add = Math.trunc(Number(body.addQuantity) || 0);
      data.quantity = Math.max(0, existing.quantity + add);
    } else if (body.quantity !== undefined) {
      data.quantity = Math.max(0, Math.trunc(Number(body.quantity)) || 0);
    }

    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.category !== undefined) data.category = String(body.category).trim().toUpperCase();
    if (body.minStock !== undefined)
      data.minStock = Math.max(0, Math.trunc(Number(body.minStock)) || 0);
    if (body.unit !== undefined) data.unit = String(body.unit).trim();
    if (body.location !== undefined)
      data.location = body.location ? String(body.location).trim() : null;
    if (body.pricePerUnit !== undefined)
      data.pricePerUnit =
        body.pricePerUnit === null || body.pricePerUnit === ""
          ? null
          : Number(body.pricePerUnit);
    if (body.description !== undefined)
      data.description = body.description ? String(body.description) : null;
    if (body.expiryDate !== undefined)
      data.expiryDate = body.expiryDate ? new Date(String(body.expiryDate)) : null;

    // Stock-in with supplier details → record an InventoryPurchase row
    if (body.addQuantity !== undefined && (body.supplier || body.invoiceNumber || body.purchasePrice)) {
      const add = Math.trunc(Number(body.addQuantity) || 0);
      await this.inventoryRepository.createPurchase({
        itemId: id,
        quantity: add,
        pricePerUnit:
          body.purchasePrice !== undefined &&
          body.purchasePrice !== "" &&
          Number.isFinite(Number(body.purchasePrice))
            ? Number(body.purchasePrice)
            : null,
        supplier: body.supplier ? String(body.supplier).trim() : null,
        invoiceNumber: body.invoiceNumber ? String(body.invoiceNumber).trim() : null,
        purchaseDate: body.purchaseDate ? new Date(String(body.purchaseDate)) : new Date(),
      });
    }

    const item = await this.inventoryRepository.updateItem(id, data);
    log.info("inventory_item_updated", {
      itemId: id,
      code: item.code,
      name: item.name,
      quantity: item.quantity,
      ...(body.addQuantity !== undefined
        ? { stockAdded: Math.trunc(Number(body.addQuantity) || 0) }
        : {}),
      fields: Object.keys(data),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "STOCK_UPDATE",
      "InventoryItem",
      body.addQuantity !== undefined
        ? `${item.name} ${addQuantityLog(body.addQuantity)} → ${item.quantity}`
        : item.name,
      actor.userId
    );
    return item;
  }

  /** DELETE /api/inventory/:id (ADMIN) — purchases + distributions first. */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.inventoryRepository.findItem(id);
    if (!existing) {
      log.warn("inventory_item_delete_not_found", { itemId: id, actor: actor.userId });
      throw new NotFoundError("Inventory item not found");
    }

    await this.inventoryRepository.deletePurchases(id);
    await this.inventoryRepository.deleteDistributions(id);
    await this.inventoryRepository.deleteItem(id);
    log.info("inventory_item_deleted", {
      itemId: id,
      code: existing.code,
      name: existing.name,
      actor: actor.userId,
    });

    await logActivity(actor.name, "STOCK_DELETE", "InventoryItem", existing.name, actor.userId);
    return { ok: true };
  }
}
