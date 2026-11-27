/**
 * Prisma implementation of the inventory transaction repository — the ONLY
 * place in the inventory-transactions module that touches Prisma models
 * directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CreateTransactionData,
  InventoryItemStock,
  InventoryTransactionRepository,
  TransactionListFilter,
  TransactionWithItem,
} from "./inventory-transaction.repository.interface";

const ITEM_INCLUDE = {
  item: { select: { id: true, code: true, name: true, unit: true } },
} as const;

export class PrismaInventoryTransactionRepository implements InventoryTransactionRepository {
  async findItemStockById(id: string): Promise<InventoryItemStock | null> {
    return db.inventoryItem.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, quantity: true },
    });
  }

  async findCampById(id: string): Promise<{ id: string } | null> {
    return db.medicalCamp.findUnique({ where: { id }, select: { id: true } });
  }

  async adjustStock(itemId: string, delta: number): Promise<number> {
    // The gte guard makes the decrement atomic — stock can never go below zero.
    const result = await db.inventoryItem.updateMany({
      where: delta < 0 ? { id: itemId, quantity: { gte: Math.abs(delta) } } : { id: itemId },
      data: { quantity: { increment: delta } },
    });
    return result.count;
  }

  async reloadItemStock(itemId: string): Promise<InventoryItemStock> {
    return db.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { id: true, code: true, name: true, quantity: true },
    });
  }

  async count(filter: TransactionListFilter): Promise<number> {
    return db.inventoryTransaction.count({
      where: {
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(filter.campId ? { campId: filter.campId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
      },
    });
  }

  async list(filter: TransactionListFilter): Promise<TransactionWithItem[]> {
    const rows = await db.inventoryTransaction.findMany({
      where: {
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(filter.campId ? { campId: filter.campId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
      },
      include: ITEM_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: filter.skip,
      take: filter.take,
    });
    return rows as TransactionWithItem[];
  }

  /** itemId/campId are FKs — a stale id maps to a 409 instead of a raw 500. */
  async create(data: CreateTransactionData): Promise<TransactionWithItem> {
    return mapPrismaError(() =>
      db.inventoryTransaction.create({ data, include: ITEM_INCLUDE })
    );
  }
}
