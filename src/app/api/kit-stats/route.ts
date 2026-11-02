import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/kit-stats (auth)
export async function GET() {
  try {
    await requireAuth();

    const [total, ready, scanned] = await Promise.all([
      db.kitUnit.count(),
      db.kitUnit.count({ where: { status: "READY" } }),
      db.kitUnit.count({ where: { status: "SCANNED" } }),
    ]);

    const batchesRaw = await db.kitBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { template: { select: { name: true } } },
    });

    const recentScans = await db.kitUnit.findMany({
      where: { status: "SCANNED" },
      orderBy: { scannedAt: "desc" },
      take: 8,
      select: { code: true, scannedByName: true, location: true, scannedAt: true },
    });

    return json({
      units: { total, ready, scanned },
      batches: batchesRaw.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        totalUnits: b.totalUnits,
        scannedUnits: b.scannedUnits,
        templateName: b.template.name,
      })),
      recentScans,
    });
  } catch (e) {
    return handleError(e);
  }
}
