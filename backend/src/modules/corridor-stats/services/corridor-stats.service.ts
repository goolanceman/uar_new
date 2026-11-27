/**
 * Corridor-stats service — green-corridor + fleet analytics. Pure shaping of
 * the repository's raw aggregates; the legacy math (5-layer alert fallback
 * chain ordering, weekly Monday buckets, fleet utilization sort) is kept
 * verbatim. Read-only snapshot: no logs, no cache, exactly like the legacy
 * route.
 */
import type {
  CorridorStatsBundle,
  CorridorStatsRepository,
} from "../repositories/corridor-stats.repository.interface";

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

export interface CorridorStatsResponse {
  missions: { total: number; completed: number; active: number };
  vehiclesAlerted: number;
  timeSavedMin: number;
  avgSavedSec: number;
  completionRate: number;
  byMethod: Array<{ method: string; count: number; savedSec: number }>;
  bySegment: Array<{ segment: string; count: number; savedSec: number }>;
  topSegments: Array<{ segment: string; count: number; savedSec: number }>;
  byEmergencyType: Array<{ type: string; count: number }>;
  congestionDistribution: Array<{ congestion: string; count: number }>;
  weekly: Array<{ label: string; count: number }>;
  fleet: {
    total: number;
    available: number;
    onMission: number;
    maintenance: number;
    availabilityPct: number;
  };
  fleetUtilization: Array<{
    id: string;
    code: string;
    type: string;
    missions: number;
    completed: number;
    savedSec: number;
  }>;
}

export class CorridorStatsService {
  constructor(private readonly corridorStatsRepository: CorridorStatsRepository) {}

  /** GET /api/corridor-stats (auth). */
  async stats(): Promise<CorridorStatsResponse> {
    const now = new Date();
    const firstStart = weekStart(
      new Date(now.getTime() - (WEEKS - 1) * 7 * 86_400_000)
    );
    const bundle = await this.corridorStatsRepository.loadBundle(firstStart);
    return this.shape(bundle, firstStart);
  }

  /** Wire mapping — keeps every legacy key (missions / vehiclesAlerted /
   *  timeSavedMin / avgSavedSec / byMethod / bySegment) and adds the richer
   *  analytics payload used by the admin Analytics tab. */
  private shape(b: CorridorStatsBundle, firstStart: Date): CorridorStatsResponse {
    const completedCount = b.completed;
    const avgSavedSec = completedCount
      ? Math.round((b.completedAgg._sum.timeSavedSec ?? 0) / completedCount)
      : 0;

    // 8-week mission trend (weekly buckets, Monday starts)
    const weekly: { label: string; count: number }[] = [];
    for (let i = 0; i < WEEKS; i++) {
      const start = new Date(firstStart.getTime() + i * 7 * 86_400_000);
      const end = new Date(start.getTime() + 7 * 86_400_000);
      const count = b.recentMissions.filter((m) => {
        const t = new Date(m.createdAt).getTime();
        return t >= start.getTime() && t < end.getTime();
      }).length;
      weekly.push({ label: WEEK_LABEL_FMT.format(start), count });
    }

    const fleetCounts = {
      total: b.ambulances.length,
      available: b.ambulances.filter((a) => a.status === "AVAILABLE").length,
      onMission: b.ambulances.filter((a) => a.status === "ON_MISSION").length,
      maintenance: b.ambulances.filter((a) => a.status === "MAINTENANCE").length,
    };

    return {
      missions: { total: b.total, completed: b.completed, active: b.active },
      vehiclesAlerted: b.agg._sum.vehiclesAlerted ?? 0,
      timeSavedMin: Math.round((b.agg._sum.timeSavedSec ?? 0) / 60),
      avgSavedSec,
      completionRate: b.total ? Math.round((b.completed / b.total) * 100) : 0,
      byMethod: METHODS.map((m) => {
        const hit = b.byMethodRaw.find((r) => r.method === m);
        return {
          method: m,
          count: hit?._count._all ?? 0,
          savedSec: hit?._sum.timeSavedSec ?? 0,
        };
      }),
      bySegment: b.bySegmentRaw
        .map((r) => ({
          segment: r.segment,
          count: r._count._all,
          savedSec: r._sum.timeSavedSec ?? 0,
        }))
        .sort((a, b2) => b2.count - a.count || b2.savedSec - a.savedSec),
      topSegments: b.bySegmentRaw
        .map((r) => ({
          segment: r.segment,
          count: r._count._all,
          savedSec: r._sum.timeSavedSec ?? 0,
        }))
        .sort((a, b2) => b2.savedSec - a.savedSec)
        .slice(0, 6),
      byEmergencyType: EMERGENCY_TYPES.map((t) => ({
        type: t,
        count: b.byTypeRaw.find((r) => r.emergencyType === t)?._count._all ?? 0,
      })),
      congestionDistribution: CONGESTIONS.map((c) => ({
        congestion: c,
        count: b.byCongestionRaw.find((r) => r.congestion === c)?._count._all ?? 0,
      })),
      weekly,
      fleet: {
        ...fleetCounts,
        availabilityPct: fleetCounts.total
          ? Math.round((fleetCounts.available / fleetCounts.total) * 100)
          : 0,
      },
      fleetUtilization: b.ambulances
        .map((a) => ({
          id: a.id,
          code: a.code,
          type: a.type,
          missions: b.byAmbRaw.find((r) => r.ambulanceId === a.id)?._count._all ?? 0,
          completed:
            b.byAmbCompletedRaw.find((r) => r.ambulanceId === a.id)?._count._all ?? 0,
          savedSec:
            b.byAmbRaw.find((r) => r.ambulanceId === a.id)?._sum.timeSavedSec ?? 0,
        }))
        .sort((a, b2) => b2.missions - a.missions || a.code.localeCompare(b2.code)),
    };
  }
}
