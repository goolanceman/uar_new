/**
 * Inventory transaction repository contract — stock movements over the
 * inventory items. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface InventoryItemStock {
  id: string;
  code: string;
  name: string;
  quantity: number;
}

export interface TransactionRow {
  id: string;
  itemId: string;
  campId: string | null;
  type: string;
  quantity: number;
  batchNo: string | null;
  expiryDate: Date | null;
  source: string | null;
  owner: string;
  refType: string | null;
  refId: string | null;
  notes: string | null;
  handledByName: string | null;
  createdAt: Date;
}

export interface TransactionWithItem extends TransactionRow {
  item: { id: string; code: string; name: string; unit: string };
}

export interface TransactionListFilter {
  itemId?: string;
  campId?: string;
  type?: string;
  skip: number;
  take: number;
}

export interface CreateTransactionData {
  itemId: string;
  campId: string | null;
  type: string;
  quantity: number;
  batchNo: string | null;
  expiryDate: Date | null;
  source: string | null;
  owner: string;
  notes: string | null;
  handledByName: string | null;
}

export interface InventoryTransactionRepository {
  findItemStockById(id: string): Promise<InventoryItemStock | null>;
  findCampById(id: string): Promise<{ id: string } | null>;
  /** Applies a signed delta guarded on available stock; returns matched rows. */
  adjustStock(itemId: string, delta: number): Promise<number>;
  reloadItemStock(itemId: string): Promise<InventoryItemStock>;
  count(filter: TransactionListFilter): Promise<number>;
  list(filter: TransactionListFilter): Promise<TransactionWithItem[]>;
  create(data: CreateTransactionData): Promise<TransactionWithItem>;
}
