/**
 * Inventory repository contract — persistence operations for stock items,
 * their purchase history and distributions. The service layer depends on this
 * interface, never on Prisma directly.
 */
import type { InventoryItem } from "@prisma/client";

/** Row shape returned to the wire (legacy include on the :id detail). */
export type InventoryItemDetailRow = InventoryItem & {
  purchases: Array<{
    id: string;
    itemId: string;
    quantity: number;
    pricePerUnit: number | null;
    totalPrice: number | null;
    supplier: string | null;
    invoiceNumber: string | null;
    purchaseDate: Date;
    notes: string | null;
    createdAt: Date;
  }>;
  distributions: Array<{
    id: string;
    itemId: string;
    quantity: number;
    distributionId: string | null;
    notes: string | null;
    createdAt: Date;
  }>;
};

export interface InventoryListWhere {
  category?: string;
  q?: string;
}

export interface InventoryItemCreateData {
  code: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  minStock: number;
  location: string | null;
  pricePerUnit: number | null;
  description: string | null;
  expiryDate: Date | null;
}

/** Field patch — only present keys are written (legacy assembly order kept). */
export interface InventoryItemUpdateData {
  quantity?: number;
  name?: string;
  category?: string;
  minStock?: number;
  unit?: string;
  location?: string | null;
  pricePerUnit?: number | null;
  description?: string | null;
  expiryDate?: Date | null;
}

export interface InventoryPurchaseCreateData {
  itemId: string;
  quantity: number;
  pricePerUnit: number | null;
  supplier: string | null;
  invoiceNumber: string | null;
  purchaseDate: Date;
}

export interface InventoryRepository {
  listItems(where: InventoryListWhere): Promise<InventoryItem[]>;
  findItem(id: string): Promise<InventoryItem | null>;
  findItemDetail(id: string): Promise<InventoryItemDetailRow | null>;
  /** Sum of distributed quantity for an item (legacy usedTotal aggregate). */
  sumDistributedQuantity(itemId: string): Promise<number | null>;

  createItem(data: InventoryItemCreateData): Promise<InventoryItem>;
  createPurchase(data: InventoryPurchaseCreateData): Promise<void>;
  updateItem(id: string, data: InventoryItemUpdateData): Promise<InventoryItem>;

  deletePurchases(itemId: string): Promise<number>;
  deleteDistributions(itemId: string): Promise<number>;
  deleteItem(id: string): Promise<void>;
}
