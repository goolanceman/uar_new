/**
 * Kit stats repository contract — the aggregated ration-kit dashboard read.
 */
export interface KitBatchWithTemplate {
  id: string;
  name: string;
  status: string;
  totalUnits: number;
  scannedUnits: number;
  template: { name: string };
}

export interface RecentKitScan {
  code: string;
  scannedByName: string | null;
  location: string | null;
  scannedAt: Date | null;
}

export interface KitStatsRepository {
  /** Legacy order: the three unit counters in parallel, then batches, then
   * recent scans (each awaited in sequence after the counts). */
  countUnits(): Promise<{ total: number; ready: number; scanned: number }>;
  listRecentBatches(): Promise<KitBatchWithTemplate[]>;
  listRecentScans(): Promise<RecentKitScan[]>;
}
