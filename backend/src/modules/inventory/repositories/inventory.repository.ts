/**
 * Prisma implementation of the inventory repository — the ONLY place in the
 * inventory module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { InventoryItem, Prisma } from "@prisma/client";
import type {
  InventoryItemCreateData,
  InventoryItemDetailRow,
  InventoryItemUpdateData,
  InventoryListWhere,
  InventoryPurchaseCreateData,
  InventoryRepository,
} from "./inventory.repository.interface";

export class PrismaInventoryRepository implements InventoryRepository {
  async listItems(where: InventoryListWhere): Promise<InventoryItem[]> {
    const prismaWhere: Prisma.InventoryItemWhereInput = {};
    if (where.category) prismaWhere.category = where.category;
    if (where.q) prismaWhere.OR = [{ name: { contains: where.q } }, { code: { contains: where.q } }];

    return db.inventoryItem.findMany({
      where: prismaWhere,
      orderBy: { name: "asc" },
    });
  }

  async findItem(id: string): Promise<InventoryItem | null> {
    return db.inventoryItem.findUnique({ where: { id } });
  }

  async findItemDetail(id: string): Promise<InventoryItemDetailRow | null> {
    return db.inventoryItem.findUnique({
      where: { id },
      include: {
        purchases: { orderBy: { purchaseDate: "desc" }, take: 50 },
        distributions: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
  }

  async sumDistributedQuantity(itemId: string): Promise<number | null> {
    const usedTotal = await db.inventoryDistribution.aggregate({
      where: { itemId },
      _sum: { quantity: true },
    });
    return usedTotal._sum.quantity;
  }

  async createItem(data: InventoryItemCreateData): Promise<InventoryItem> {
    return mapPrismaError(() => db.inventoryItem.create({ data }));
  }

  async createPurchase(data: InventoryPurchaseCreateData): Promise<void> {
    await mapPrismaError(() => db.inventoryPurchase.create({ data }));
  }

  async updateItem(id: string, data: InventoryItemUpdateData): Promise<InventoryItem> {
    return mapPrismaError(() => db.inventoryItem.update({ where: { id }, data }));
  }

  async deletePurchases(itemId: string): Promise<number> {
    const result = await db.inventoryPurchase.deleteMany({ where: { itemId } });
    return result.count;
  }

  async deleteDistributions(itemId: string): Promise<number> {
    const result = await db.inventoryDistribution.deleteMany({ where: { itemId } });
    return result.count;
  }

  async deleteItem(id: string): Promise<void> {
    await db.inventoryItem.delete({ where: { id } });
  }
}
