import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/corridor-stats (auth)
export async function GET() {
  try {
    await requireAuth();

    const [total, completed, active, agg, completedAgg, byMethodRaw, bySegmentRaw] =
      await Promise.all([
        db.mission.count(),
        db.mission.count({ where: { status: "COMPLETED" } }),
        db.mission.count({
          where: { status: { in: ["DISPATCHED", "EN_ROUTE", "ARRIVED"] } },
        }),
        db.mission.aggregate({
          _sum: { vehiclesAlerted: true, timeSavedSec: true },
        }),
        db.mission.aggregate({
          where: { status: "COMPLETED" },
          _sum: { timeSavedSec: true },
        }),
        db.corridorEvent.groupBy({
          by: ["method"],
          _count: { _all: true },
          _sum: { timeSavedSec: true },
        }),
        db.corridorEvent.groupBy({
          by: ["segment"],
          _count: { _all: true },
          _sum: { timeSavedSec: true },
        }),
      ]);

    const completedCount = completed;
    const avgSavedSec = completedCount
      ? Math.round((completedAgg._sum.timeSavedSec ?? 0) / completedCount)
      : 0;

    return json({
      missions: { total, completed, active },
      vehiclesAlerted: agg._sum.vehiclesAlerted ?? 0,
      timeSavedMin: Math.round((agg._sum.timeSavedSec ?? 0) / 60),
      avgSavedSec,
      byMethod: byMethodRaw
        .map((r) => ({
          method: r.method,
          count: r._count._all,
          savedSec: r._sum.timeSavedSec ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
      bySegment: bySegmentRaw
        .map((r) => ({
          segment: r.segment,
          count: r._count._all,
          savedSec: r._sum.timeSavedSec ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (e) {
    return handleError(e);
  }
}
