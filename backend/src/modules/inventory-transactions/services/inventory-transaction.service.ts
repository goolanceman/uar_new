/**
 * Inventory transaction service — stock movement rules. The signed quantity
 * delta per type is applied to InventoryItem.quantity (stock never goes below
 * zero → 409) and the movement is recorded with the handler's name. Depends
 * on the repository contract, throws application errors, never touches HTTP.
 *
 * The legacy POST validated body fields mid-handler after the item lookup, so
 * those checks and their exact messages live here instead of in a route-level
 * Zod schema.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import type {
  InventoryItemStock,
  InventoryTransactionRepository,
  TransactionListFilter,
  TransactionWithItem,
} from "../repositories/inventory-transaction.repository.interface";
import type {
  CreateTransactionBody,
  ListTransactionsQuery,
} from "../schemas/inventory-transaction.schema";

const log = logger.child("inventory-transactions");

const VALID_TYPES = ["RECEIVED", "ISSUED", "TRANSFERRED", "CONSUMED", "RETURNED", "ADJUSTED"];
// Signed quantity deltas applied to InventoryItem.quantity per type.
// ADJUSTED expects an explicit signed delta; TRANSFERRED moves stock between
// locations without changing the total, so it carries no delta here.
const DELTAS: Record<string, number> = {
  RECEIVED: 1,
  ISSUED: -1,
  CONSUMED: -1,
  RETURNED: 1,
  ADJUSTED: 0, // signed as provided
  TRANSFERRED: 0,
};

function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function optDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface TransactionListPayload {
  items: TransactionWithItem[];
  total: number;
  page: number;
  pages: number;
}

export class InventoryTransactionService {
  constructor(private readonly inventoryTransactionRepository: InventoryTransactionRepository) {}

  /**
   * GET /api/inventory-transactions — ADMIN. Filters: itemId, campId, type
   * (case-sensitive; invalid values get the legacy 400 before any DB call).
   */
  async list(query: ListTransactionsQuery): Promise<TransactionListPayload> {
    if (query.type && !VALID_TYPES.includes(query.type))
      throw new ApiError(`type must be one of: ${VALID_TYPES.join(", ")}`, 400);

    const filter: TransactionListFilter = {
      itemId: query.itemId,
      campId: query.campId,
      type: query.type,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    };

    const [total, items] = await Promise.all([
      this.inventoryTransactionRepository.count(filter),
      this.inventoryTransactionRepository.list(filter),
    ]);

    return { items, total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)) };
  }

  /**
   * POST /api/inventory-transactions — ADMIN. { itemId, campId?, type,
   * quantity (signed), batchNo?, expiryDate?, source?, notes? } — the
   * quantity delta is applied to InventoryItem.quantity and the stock is
   * never allowed to go below zero (409).
   */
  async create(actor: Session, body: CreateTransactionBody): Promise<{ transaction: TransactionWithItem; itemQuantity: number }> {
    const itemId = String(body?.itemId ?? "").trim();
    if (!itemId) throw new ApiError("itemId is required", 400);
    const item = await this.inventoryTransactionRepository.findItemStockById(itemId);
    if (!item) {
      log.warn("inventory_txn_item_not_found", { itemId, actor: actor.userId });
      throw new ApiError("Inventory item not found", 404);
    }

    const type = String(body?.type ?? "").trim().toUpperCase();
    if (!VALID_TYPES.includes(type))
      throw new ApiError(`type must be one of: ${VALID_TYPES.join(", ")}`, 400);

    const quantity = Number(body?.quantity);
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity === 0)
      throw new ApiError("quantity must be a non-zero integer", 400);

    let delta: number;
    if (type === "ADJUSTED") {
      delta = quantity; // explicit signed delta
    } else {
      const sign = DELTAS[type];
      delta = sign === 0 ? 0 : sign * Math.abs(quantity);
    }

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await this.inventoryTransactionRepository.findCampById(campId);
      if (!camp) {
        log.warn("inventory_txn_camp_not_found", { itemId, campId, actor: actor.userId });
        throw new ApiError("Camp not found", 404);
      }
    }

    let updated: InventoryItemStock = item;
    if (delta !== 0) {
      const matched = await this.inventoryTransactionRepository.adjustStock(itemId, delta);
      if (matched === 0) {
        log.warn("inventory_txn_insufficient_stock", {
          itemId,
          itemCode: item.code,
          type,
          currentQuantity: item.quantity,
          requested: Math.abs(delta),
          actor: actor.userId,
        });
        throw new ApiError(
          `Insufficient stock for ${item.name} (current quantity ${item.quantity}, tried to remove ${Math.abs(delta)})`,
          409
        );
      }
      updated = await this.inventoryTransactionRepository.reloadItemStock(itemId);
    }

    const txn = await this.inventoryTransactionRepository.create({
      itemId,
      campId,
      type,
      quantity: delta,
      batchNo: optText(body?.batchNo),
      expiryDate: optDate(body?.expiryDate),
      source: optText(body?.source),
      owner: "UAR",
      notes: optText(body?.notes),
      handledByName: actor.name,
    });

    log.info("inventory_txn_created", {
      txnId: txn.id,
      itemId,
      itemCode: item.code,
      type,
      quantity: delta,
      newQuantity: updated.quantity,
      ...(campId ? { campId } : {}),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "INVENTORY_TXN",
      "INVENTORY_TRANSACTION",
      `${item.code} (${item.name}) — ${type} ${delta >= 0 ? "+" : ""}${delta} → ${updated.quantity}`,
      actor.userId
    );

    return { transaction: txn, itemQuantity: updated.quantity };
  }
}
