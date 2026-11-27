/**
 * Kit stats service — assembles the /api/kit-stats snapshot wire shape:
 * unit counters, the 10 newest batches (templateName flattened) and the 8
 * latest scans. The repository call order mirrors the legacy awaits exactly.
 */
import type {
  KitStatsRepository,
  RecentKitScan,
} from "../repositories/kit-stats.repository.interface";

export interface KitStatsSnapshot {
  units: { total: number; ready: number; scanned: number };
  batches: Array<{
    id: string;
    name: string;
    status: string;
    totalUnits: number;
    scannedUnits: number;
    templateName: string;
  }>;
  recentScans: RecentKitScan[];
}

export class KitStatsService {
  constructor(private readonly kitStatsRepository: KitStatsRepository) {}

  /** GET /api/kit-stats (auth) — counters + newest batches + recent scans. */
  async snapshot(): Promise<KitStatsSnapshot> {
    const units = await this.kitStatsRepository.countUnits();
    const batchesRaw = await this.kitStatsRepository.listRecentBatches();
    const recentScans = await this.kitStatsRepository.listRecentScans();

    return {
      units,
      batches: batchesRaw.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        totalUnits: b.totalUnits,
        scannedUnits: b.scannedUnits,
        templateName: b.template.name,
      })),
      recentScans,
    };
  }
}
