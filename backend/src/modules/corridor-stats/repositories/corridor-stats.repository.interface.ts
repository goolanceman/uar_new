/**
 * Corridor-stats repository contract — the raw mission / corridor-event /
 * ambulance aggregates behind the /api/corridor-stats analytics snapshot.
 * The service layer depends on this interface, never on Prisma directly.
 */

// ─── groupBy aggregate rows (exact Prisma shapes) ────────────────────────────

export interface ByMethodRow {
  method: string;
  _count: { _all: number };
  _sum: { timeSavedSec: number | null };
}

export interface BySegmentRow {
  segment: string;
  _count: { _all: number };
  _sum: { timeSavedSec: number | null };
}

export interface ByEmergencyTypeRow {
  emergencyType: string;
  _count: { _all: number };
}

export interface ByCongestionRow {
  congestion: string;
  _count: { _all: number };
}

export interface MissionCreatedRow {
  createdAt: Date;
}

export interface AmbulanceLiteRow {
  id: string;
  code: string;
  type: string;
  status: string;
}

export interface ByAmbulanceRow {
  ambulanceId: string | null;
  _count: { _all: number };
  _sum: { timeSavedSec: number | null };
}

export interface ByAmbulanceCompletedRow {
  ambulanceId: string | null;
  _count: { _all: number };
}

// ─── The bundle ──────────────────────────────────────────────────────────────

/** Everything the service needs, loaded in one Promise.all (legacy parity). */
export interface CorridorStatsBundle {
  total: number;
  completed: number;
  active: number;
  agg: { _sum: { vehiclesAlerted: number | null; timeSavedSec: number | null } };
  completedAgg: { _sum: { timeSavedSec: number | null } };
  byMethodRaw: ByMethodRow[];
  bySegmentRaw: BySegmentRow[];
  byTypeRaw: ByEmergencyTypeRow[];
  byCongestionRaw: ByCongestionRow[];
  recentMissions: MissionCreatedRow[];
  ambulances: AmbulanceLiteRow[];
  byAmbRaw: ByAmbulanceRow[];
  byAmbCompletedRaw: ByAmbulanceCompletedRow[];
}

export interface CorridorStatsRepository {
  loadBundle(firstStart: Date): Promise<CorridorStatsBundle>;
}
