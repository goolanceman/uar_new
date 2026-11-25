/**
 * Kit stats route — /api/kit-stats
 * Converted 1:1 from src/app/api/kit-stats/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const router = Router();

// GET /api/kit-stats (auth)
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);

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

    return json(res, {
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
    return handleError(e, res);
  }
});
