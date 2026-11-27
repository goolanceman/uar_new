/**
 * Kit unit repository contract — the scanned ration-kit registry.
 */
export interface KitUnitListFilter {
  batchId?: string;
  status?: string;
  q?: string;
  scannedById?: string;
  limit: number;
}

export interface KitUnitWithBatch {
  id: string;
  batchId: string;
  code: string;
  status: string;
  scannedAt: Date | null;
  scannedById: string | null;
  scannedByName: string | null;
  location: string | null;
  distributionId: string | null;
  batch: { name: string; template: { name: string } };
}

export interface KitUnitRepository {
  /** Order by code asc, batch + template names attached (legacy include). */
  list(filter: KitUnitListFilter): Promise<KitUnitWithBatch[]>;
}
