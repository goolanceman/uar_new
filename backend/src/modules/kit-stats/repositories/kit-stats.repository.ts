/**
 * Prisma implementation of the kit stats repository — the ONLY place in the
 * kit-stats module that touches Prisma models directly. (Read-only counts and
 * lists: no unique/FK violation risk, so no mapPrismaError wrap.)
 */
import { db } from "@/infrastructure/database/prisma";
import type {
  KitBatchWithTemplate,
  KitStatsRepository,
  RecentKitScan,
} from "./kit-stats.repository.interface";

export class PrismaKitStatsRepository implements KitStatsRepository {
  async countUnits(): Promise<{ total: number; ready: number; scanned: number }> {
    const [total, ready, scanned] = await Promise.all([
      db.kitUnit.count(),
      db.kitUnit.count({ where: { status: "READY" } }),
      db.kitUnit.count({ where: { status: "SCANNED" } }),
    ]);
    return { total, ready, scanned };
  }

  async listRecentBatches(): Promise<KitBatchWithTemplate[]> {
    const batches = await db.kitBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { template: { select: { name: true } } },
    });
    return batches as KitBatchWithTemplate[];
  }

  async listRecentScans(): Promise<RecentKitScan[]> {
    return db.kitUnit.findMany({
      where: { status: "SCANNED" },
      orderBy: { scannedAt: "desc" },
      take: 8,
      select: { code: true, scannedByName: true, location: true, scannedAt: true },
    });
  }
}
