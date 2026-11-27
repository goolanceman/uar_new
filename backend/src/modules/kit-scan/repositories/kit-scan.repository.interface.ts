/**
 * Kit scan repository contract — persistence for the kit-unit scan flow.
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

export interface KitUnitRow {
  id: string;
  batchId: string;
  code: string;
  status: string;
  scannedAt: Date | null;
  scannedById: string | null;
  scannedByName: string | null;
  location: string | null;
  distributionId: string | null;
}

export interface KitUnitWithBatch extends KitUnitRow {
  batch: KitBatchRow;
}

export interface KitScanRepository {
  /** Unit by unique QR code, with its parent batch. */
  findUnitByCode(code: string): Promise<KitUnitWithBatch | null>;
  /** Flip the unit to SCANNED with scan metadata. */
  markUnitScanned(
    id: string,
    data: {
      status: string;
      scannedAt: Date;
      scannedById: string | null;
      scannedByName: string | null;
      location: string | null;
    }
  ): Promise<KitUnitRow>;
  /** Roll the scanned-unit count (and derived status) up to the batch. */
  updateBatch(id: string, data: { scannedUnits: number; status: string }): Promise<KitBatchRow>;
}
