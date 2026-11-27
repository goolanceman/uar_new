/**
 * Prisma implementation of the food inventory repository — the ONLY place in
 * the food module that touches FoodBatch/InventoryItem/InventoryTransaction/
 * FoodStockAllocation models directly. Legacy query shapes are reproduced
 * verbatim.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  AllocationRow,
  AllocationWithEvent,
  BatchCreateData,
  BatchListItem,
  BatchListFilters,
  BatchPatchData,
  BatchWithItem,
  FoodInventoryRepository,
  InventoryItemRow,
  InventoryTxCreateData,
} from "./food-inventory.repository.interface";

export class PrismaFoodInventoryRepository implements FoodInventoryRepository {
  async findItemById(id: string, client?: DbClient): Promise<InventoryItemRow | null> {
    return (client ?? db).inventoryItem.findUnique({ where: { id } });
  }

  async listFoodKitInventory() {
    return db.inventoryItem.findMany({
      where: { category: "FOOD_KIT" },
      select: { id: true, name: true, quantity: true, unit: true },
    });
  }

  async listExpiringPassedBatches(windowDays: number) {
    return db.foodBatch.findMany({
      where: {
        qualityStatus: "PASSED",
        status: "ACTIVE",
        expiryDate: { lte: new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, batchNo: true, expiryDate: true, itemId: true },
    });
  }

  async findBatchByItemAndBatchNo(itemId: string, batchNo: string) {
    return db.foodBatch.findUnique({
      where: { itemId_batchNo: { itemId, batchNo } },
    });
  }

  /** (itemId, batchNo) is unique — a lost race with the pre-check renders as 409. */
  async createBatch(data: BatchCreateData, client: DbClient) {
    return mapPrismaError(() => client.foodBatch.create({ data }));
  }

  async incrementItemQuantity(id: string, by: number, client: DbClient): Promise<void> {
    await client.inventoryItem.update({
      where: { id },
      data: { quantity: { increment: by } },
    });
  }

  async decrementItemQuantity(id: string, by: number, client: DbClient): Promise<void> {
    await client.inventoryItem.update({
      where: { id },
      data: { quantity: { decrement: by } },
    });
  }

  async createInventoryTransaction(data: InventoryTxCreateData, client: DbClient) {
    return client.inventoryTransaction.create({ data });
  }

  async listBatches(filters: BatchListFilters): Promise<BatchListItem[]> {
    // Legacy where building: raw sp strings, parseInt(...) || 0 expiry window.
    const where: Record<string, unknown> = {};
    if (filters.itemId) where.itemId = filters.itemId;
    if (filters.quality) where.qualityStatus = filters.quality;
    if (filters.expiring) {
      const days = parseInt(filters.expiring, 10) || 0;
      where.expiryDate = { lte: new Date(Date.now() + days * 24 * 60 * 60 * 1000) };
      where.status = "ACTIVE";
    }
    if (filters.q) {
      where.OR = [
        { batchNo: { contains: filters.q } },
        { donorName: { contains: filters.q } },
        { supplierName: { contains: filters.q } },
      ];
    }

    const rows = await db.foodBatch.findMany({
      where,
      orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
      take: 500,
      include: { item: { select: { id: true, name: true, unit: true, category: true } } },
    });
    return rows as BatchListItem[];
  }

  async findBatchWithItem(id: string): Promise<BatchWithItem | null> {
    return db.foodBatch.findUnique({ where: { id }, include: { item: true } });
  }

  async updateBatch(id: string, data: BatchPatchData, client?: DbClient) {
    const run = (c: DbClient) =>
      mapPrismaError(() =>
        c.foodBatch.update({ where: { id }, data: data as import("@prisma/client").Prisma.FoodBatchUncheckedUpdateInput })
      );
    return client ? run(client) : run(db);
  }

  async findAllocationWithEvent(id: string): Promise<AllocationWithEvent | null> {
    const allocation = await db.foodStockAllocation.findUnique({
      where: { id },
      include: { event: { select: { code: true } } },
    });
    return allocation as AllocationWithEvent | null;
  }

  async findAllocationById(id: string) {
    return db.foodStockAllocation.findUnique({ where: { id } });
  }

  async listReservedAllocations(eventId: string, client: DbClient) {
    return client.foodStockAllocation.findMany({
      where: { eventId, status: "RESERVED" },
    });
  }

  async listIssuedAllocations(eventId: string, client: DbClient) {
    return client.foodStockAllocation.findMany({
      where: { eventId, status: "ISSUED" },
      orderBy: { createdAt: "asc" },
    });
  }

  async updateAllocationStatus(id: string, status: string, client: DbClient): Promise<void> {
    await client.foodStockAllocation.update({
      where: { id },
      data: { status },
    });
  }

  async decrementBatchReserved(batchId: string, quantity: number, client: DbClient): Promise<void> {
    await client.foodBatch.update({
      where: { id: batchId },
      data: { quantityReserved: { decrement: quantity } },
    });
  }
}
