/**
 * Prisma implementation of the corridor-stats repository — the ONLY place in
 * the corridor-stats module that touches Prisma models directly.
 * (Read-only counts/aggregates/lists: no unique/FK violation risk, so no
 * mapPrismaError wrap.)
 */
import { db } from "@/infrastructure/database/prisma";
import type {
  ByAmbulanceCompletedRow,
  ByAmbulanceRow,
  ByCongestionRow,
  ByEmergencyTypeRow,
  ByMethodRow,
  BySegmentRow,
  CorridorStatsBundle,
  CorridorStatsRepository,
} from "./corridor-stats.repository.interface";

export class PrismaCorridorStatsRepository implements CorridorStatsRepository {
  /** The legacy 13-query Promise.all — one parallel read burst. */
  async loadBundle(firstStart: Date): Promise<CorridorStatsBundle> {
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

    return {
      total,
      completed,
      active,
      agg,
      completedAgg,
      byMethodRaw: byMethodRaw as ByMethodRow[],
      bySegmentRaw: bySegmentRaw as BySegmentRow[],
      byTypeRaw: byTypeRaw as ByEmergencyTypeRow[],
      byCongestionRaw: byCongestionRaw as ByCongestionRow[],
      recentMissions,
      ambulances,
      byAmbRaw: byAmbRaw as ByAmbulanceRow[],
      byAmbCompletedRaw: byAmbCompletedRaw as ByAmbulanceCompletedRow[],
    };
  }
}
