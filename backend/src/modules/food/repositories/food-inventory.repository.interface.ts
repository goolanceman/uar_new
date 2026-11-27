/**
 * Food inventory repository contract — FoodBatch, InventoryItem,
 * InventoryTransaction and FoodStockAllocation persistence (the stock desk
 * aggregate shared by the allocation, batch, pledge and event services).
 * Transactional methods accept the caller's `client` (withTransaction
 * boundary) — repositories never obtain clients themselves.
 */
import type { FoodBatch, FoodStockAllocation, InventoryItem, InventoryTransaction } from "@prisma/client";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";

export type InventoryItemRow = InventoryItem;
export type FoodBatchRow = FoodBatch;
export type BatchWithItem = FoodBatch & { item: InventoryItem };
export type AllocationRow = FoodStockAllocation;
export type AllocationWithEvent = FoodStockAllocation & { event: { code: string } };
export type InventoryTransactionRow = InventoryTransaction;

/** GET /batches — stock desk list include (master item summary). */
export type BatchListItem = FoodBatch & {
  item: { id: string; name: string; unit: string; category: string };
};

/** Raw sp strings — the repository applies the legacy trim/parse semantics. */
export interface BatchListFilters {
  itemId?: string | null;
  q?: string | null;
  quality?: string | null;
  expiring?: string | null;
}

export interface BatchCreateData {
  itemId: string;
  batchNo: string;
  source: string;
  donorName: string | null;
  supplierName: string | null;
  quantityReceived: number;
  mfgDate: Date | null;
  expiryDate: Date | null;
  storageNotes: string | null;
  tempRequirement: string | null;
  createdByName: string;
}

/** PATCH /batches/:id field patch — keys exist only when the legacy handler
 *  set them (quantityWasted carries the Prisma increment shape). */
export interface BatchPatchData {
  storageNotes?: string | null;
  tempRequirement?: string | null;
  qualityStatus?: string;
  inspectedByName?: string;
  inspectedAt?: Date;
  rejectionReason?: string | null;
  status?: string;
  quantityWasted?: { increment: number };
}

export interface InventoryTxCreateData {
  itemId: string;
  type: string;
  quantity: number;
  batchNo: string;
  expiryDate: Date | null;
  source: string;
  refType: string;
  refId: string;
  notes: string;
  handledByName: string;
}

export interface FoodInventoryRepository {
  findItemById(id: string, client?: DbClient): Promise<InventoryItemRow | null>;
  /** Event-detail requirement lines (FOOD_KIT master stock summary). */
  listFoodKitInventory(): Promise<Array<{ id: string; name: string; quantity: number; unit: string }>>;
  /** Inspected-passed, ACTIVE batches expiring within the window (alerts). */
  listExpiringPassedBatches(windowDays: number): Promise<Array<{ id: string; batchNo: string; expiryDate: Date | null; itemId: string }>>;

  /** (itemId, batchNo) is unique — constraint failures render as conflicts. */
  findBatchByItemAndBatchNo(itemId: string, batchNo: string): Promise<FoodBatchRow | null>;
  createBatch(data: BatchCreateData, client: DbClient): Promise<FoodBatchRow>;
  incrementItemQuantity(id: string, by: number, client: DbClient): Promise<void>;
  decrementItemQuantity(id: string, by: number, client: DbClient): Promise<void>;
  createInventoryTransaction(data: InventoryTxCreateData, client: DbClient): Promise<InventoryTransactionRow>;

  listBatches(filters: BatchListFilters): Promise<BatchListItem[]>;
  findBatchWithItem(id: string): Promise<BatchWithItem | null>;
  updateBatch(id: string, data: BatchPatchData, client: DbClient): Promise<FoodBatchRow>;

  findAllocationWithEvent(id: string): Promise<AllocationWithEvent | null>;
  findAllocationById(id: string): Promise<AllocationRow | null>;
  listReservedAllocations(eventId: string, client: DbClient): Promise<AllocationRow[]>;
  /** Issued allocations oldest-first (reconciliation return order). */
  listIssuedAllocations(eventId: string, client: DbClient): Promise<AllocationRow[]>;
  updateAllocationStatus(id: string, status: string, client: DbClient): Promise<void>;
  decrementBatchReserved(batchId: string, quantity: number, client: DbClient): Promise<void>;
}
