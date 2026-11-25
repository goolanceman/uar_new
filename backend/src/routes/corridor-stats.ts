/**
 * Corridor stats route — /api/corridor-stats
 * Converted 1:1 from src/app/api/corridor-stats/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const router = Router();

/** Canonical 5-layer alert fallback chain (never reorder silently). */
const METHODS = ["V2X_5G", "CELL_BROADCAST", "BLE_MESH", "FM_RDS", "SIREN"];
const CONGESTIONS = ["LOW", "MODERATE", "HEAVY", "GRIDLOCK"];
const EMERGENCY_TYPES = [
  "CARDIAC",
  "ACCIDENT",
  "MATERNITY",
  "BURN",
  "RESPIRATORY",
  "TRANSFER",
];
const WEEKS = 8;

function weekStart(d: Date): Date {
  const dt = new Date(d);
  const day = (dt.getDay() + 6) % 7; // Monday = 0
  dt.setDate(dt.getDate() - day);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

const WEEK_LABEL_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
});

// GET /api/corridor-stats (auth)
// Green-corridor + fleet analytics. Keeps every legacy key
// (missions / vehiclesAlerted / timeSavedMin / avgSavedSec / byMethod / bySegment)
// and adds the richer analytics payload used by the admin Analytics tab.
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);

    const now = new Date();
    const firstStart = weekStart(
      new Date(now.getTime() - (WEEKS - 1) * 7 * 86_400_000)
    );

    const [
      total,
      completed,
      active,
      agg,
      completedAgg,
      byMethodRaw,
      bySegmentRaw,
      byTypeRaw,
      byCongestionRaw,
      recentMissions,
      ambulances,
      byAmbRaw,
      byAmbCompletedRaw,
    ] = await Promise.all([
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
      db.mission.groupBy({
        by: ["emergencyType"],
        _count: { _all: true },
      }),
      db.corridorEvent.groupBy({
        by: ["congestion"],
        _count: { _all: true },
      }),
      db.mission.findMany({
        where: { createdAt: { gte: firstStart } },
        select: { createdAt: true },
      }),
      db.ambulance.findMany({
        select: { id: true, code: true, type: true, status: true },
        orderBy: { code: "asc" },
      }),
      db.mission.groupBy({
        by: ["ambulanceId"],
        _count: { _all: true },
        _sum: { timeSavedSec: true },
        where: { ambulanceId: { not: null } },
      }),
      db.mission.groupBy({
        by: ["ambulanceId"],
        _count: { _all: true },
        where: { ambulanceId: { not: null }, status: "COMPLETED" },
      }),
    ]);

    const completedCount = completed;
    const avgSavedSec = completedCount
      ? Math.round((completedAgg._sum.timeSavedSec ?? 0) / completedCount)
      : 0;

    // 8-week mission trend (weekly buckets, Monday starts)
    const weekly: { label: string; count: number }[] = [];
    for (let i = 0; i < WEEKS; i++) {
      const start = new Date(firstStart.getTime() + i * 7 * 86_400_000);
      const end = new Date(start.getTime() + 7 * 86_400_000);
      const count = recentMissions.filter((m) => {
        const t = new Date(m.createdAt).getTime();
        return t >= start.getTime() && t < end.getTime();
      }).length;
      weekly.push({ label: WEEK_LABEL_FMT.format(start), count });
    }

    const fleetCounts = {
      total: ambulances.length,
      available: ambulances.filter((a) => a.status === "AVAILABLE").length,
      onMission: ambulances.filter((a) => a.status === "ON_MISSION").length,
      maintenance: ambulances.filter((a) => a.status === "MAINTENANCE").length,
    };

    return json(res, {
      missions: { total, completed, active },
      vehiclesAlerted: agg._sum.vehiclesAlerted ?? 0,
      timeSavedMin: Math.round((agg._sum.timeSavedSec ?? 0) / 60),
      avgSavedSec,
      completionRate: total ? Math.round((completed / total) * 100) : 0,
      byMethod: METHODS.map((m) => {
        const hit = byMethodRaw.find((r) => r.method === m);
        return {
          method: m,
          count: hit?._count._all ?? 0,
          savedSec: hit?._sum.timeSavedSec ?? 0,
        };
      }),
      bySegment: bySegmentRaw
        .map((r) => ({
          segment: r.segment,
          count: r._count._all,
          savedSec: r._sum.timeSavedSec ?? 0,
        }))
        .sort((a, b) => b.count - a.count || b.savedSec - a.savedSec),
      topSegments: bySegmentRaw
        .map((r) => ({
          segment: r.segment,
          count: r._count._all,
          savedSec: r._sum.timeSavedSec ?? 0,
        }))
        .sort((a, b) => b.savedSec - a.savedSec)
        .slice(0, 6),
      byEmergencyType: EMERGENCY_TYPES.map((t) => ({
        type: t,
        count: byTypeRaw.find((r) => r.emergencyType === t)?._count._all ?? 0,
      })),
      congestionDistribution: CONGESTIONS.map((c) => ({
        congestion: c,
        count: byCongestionRaw.find((r) => r.congestion === c)?._count._all ?? 0,
      })),
      weekly,
      fleet: {
        ...fleetCounts,
        availabilityPct: fleetCounts.total
          ? Math.round((fleetCounts.available / fleetCounts.total) * 100)
          : 0,
      },
      fleetUtilization: ambulances
        .map((a) => ({
          id: a.id,
          code: a.code,
          type: a.type,
          missions: byAmbRaw.find((r) => r.ambulanceId === a.id)?._count._all ?? 0,
          completed:
            byAmbCompletedRaw.find((r) => r.ambulanceId === a.id)?._count._all ?? 0,
          savedSec:
            byAmbRaw.find((r) => r.ambulanceId === a.id)?._sum.timeSavedSec ?? 0,
        }))
        .sort((a, b) => b.missions - a.missions || a.code.localeCompare(b.code)),
    });
  } catch (e) {
    return handleError(e, res);
  }
});
