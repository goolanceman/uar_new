/**
 * Kit batch repository contract — batch rows, the template/inventory lookups
 * and the batch-building transaction. The service layer depends on this
 * interface, never on Prisma directly.
 */
export interface KitBatchRow {
  id: string;
  templateId: string;
  name: string;
  totalUnits: number;
  scannedUnits: number;
  instructions: string | null;
  status: string;
  createdAt: Date;
}

export interface KitBatchTemplateSummary {
  id: string;
  name: string;
  kind: string;
  codePrefix: string | null;
  costPerUnit: number;
  items: string;
  status: string;
}

export interface KitBatchWithTemplate extends KitBatchRow {
  template: {
    name: string;
    kind: string;
    codePrefix: string | null;
    costPerUnit: number;
    items: string;
  };
  _count: { units: number };
}

/** One normalized template line to consume from master inventory. */
export interface BatchStockLine {
  itemId?: string;
  name: string;
  needed: number;
}

export interface BatchBuildPlan {
  templateId: string;
  name: string;
  totalUnits: number;
  instructions: string | null;
  templateName: string;
  codes: string[];
  lines: BatchStockLine[];
}

export interface StockMatch {
  id: string;
  name: string;
  unit: string;
  quantity: number;
}

/** Decision callback: throws (after logging) when stock falls short. */
export type StockAssertion = (match: StockMatch, needed: number) => void;

export interface KitBatchRepository {
  listBatches(status?: string): Promise<KitBatchWithTemplate[]>;
  findTemplateById(id: string): Promise<KitBatchTemplateSummary | null>;
  countKitUnits(): Promise<number>;
  findUnitCodeClash(codes: string[]): Promise<{ code: string } | null>;
  findBatchById(id: string): Promise<KitBatchRow | null>;
  findBatchWithTemplate(id: string): Promise<KitBatchWithTemplate | null>;
  /**
   * Builds the batch inside one transaction: consumes each stock line from
   * the master inventory (assertStock throws to abort the whole build),
   * creates the batch and its QR-coded units.
   */
  createBatchWithUnits(plan: BatchBuildPlan, assertStock: StockAssertion): Promise<KitBatchRow>;
  update(id: string, data: { name?: string; instructions?: string | null }): Promise<KitBatchRow>;
  deleteUnits(batchId: string): Promise<number>;
  delete(id: string): Promise<void>;
}
