/**
 * Mission service — ambulance mission rules: request creation with the
 * simulated green-corridor route, the status-stepper flow and the legacy
 * action flow (dispatch/advance/complete/cancel) with corridor-event
 * generation and the fire-and-forget dispatch SMS.
 *
 * The legacy handler validated body fields mid-handler after the mission
 * lookup (404-before-400 ordering), so those checks live here — not in a
 * route-level Zod schema. The legacy writes were NOT transactional (sequential
 * awaited updates); that side-effect order is preserved exactly.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { loadSettings, sendSms } from "@/lib/notify";
import { MISSION_FLOW, MISSION_PROGRESS } from "@/lib/missions";
import type {
  AmbulanceRow,
  CorridorEventCreateData,
  CorridorEventRow,
  MissionListRow,
  MissionRepository,
  MissionRow,
  MissionWithAmbulance,
} from "../repositories/mission.repository.interface";
import type { CreateMissionBody, ListMissionsQuery, UpdateMissionBody } from "../schemas/mission.schema";

const log = logger.child("missions");

type RouteSegment = { name: string; congestion: string; lengthKm: number };

const EMERGENCY_TYPES = [
  "CARDIAC",
  "ACCIDENT",
  "MATERNITY",
  "BURN",
  "RESPIRATORY",
  "TRANSFER",
];
const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM"];

const SEGMENT_POOL = [
  "Hebbal Flyover",
  "Outer Ring Road",
  "Silk Board Junction",
  "KR Puram Junction",
  "Tin Factory",
  "Marathahalli Bridge",
  "NICE Road",
  "Majestic Interchange",
];

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Canonical status flow (CANCELLED is a side-state allowed from any open state)
// and auto progress — single source of truth in @/lib/missions, shared with the
// admin ambulance view's stepper.
const FLOW: readonly string[] = MISSION_FLOW;
const PROGRESS: Record<string, number> = MISSION_PROGRESS;

/** Dispatch result — mission enriched with the ambulance + corridor events. */
export interface MissionDispatchResult {
  mission: MissionRow & { ambulance: AmbulanceRow | null; events: CorridorEventRow[] };
  ambulance: AmbulanceRow;
}

export type MissionMutationResult =
  | { mission: MissionRow | MissionWithAmbulance }
  | MissionDispatchResult;

/** Fire-and-forget dispatch SMS to the requester (sendSms no-ops when disabled). */
function sendDispatchSms(m: {
  contact: string;
  patientName: string;
  pickup: string;
  destination: string;
}): void {
  void (async () => {
    try {
      const map = await loadSettings();
      const out = await sendSms(map, {
        to: m.contact,
        text: `UAR green corridor: ambulance dispatched for ${m.patientName}. Pickup ${m.pickup} → ${m.destination}. Track in the app.`,
      });
      if (out && !out.ok && !out.skipped)
        log.error("dispatch_sms_failed", { error: out.message });
    } catch (e) {
      log.error("dispatch_sms_failed", {
        error: e instanceof Error ? e : String(e),
      });
    }
  })();
}

export class MissionService {
  constructor(private readonly missionRepository: MissionRepository) {}

  /** GET /api/missions?status=&q=&ambulanceId=&limit= (auth) — newest first. */
  async list(query: ListMissionsQuery): Promise<MissionListRow[]> {
    return this.missionRepository.listMissions({
      status: query.status,
      q: query.q,
      ambulanceId: query.ambulanceId,
      limit: query.limit,
    });
  }

  /**
   * POST /api/missions (ADMIN | VOLUNTEER) — generates a 4-segment simulated
   * route (1 GRIDLOCK + 1 HEAVY + 1 MODERATE + 1 LOW in random order) unless
   * an explicit route body is provided.
   */
  async create(body: CreateMissionBody, actor: Session): Promise<MissionRow> {
    const patientName = String(body.patientName ?? "").trim();
    const contact = String(body.contact ?? "").trim();
    const emergencyType =
      String(body.emergencyType ?? "").trim().toUpperCase() || "CARDIAC";
    const priority = String(body.priority ?? "HIGH").trim().toUpperCase();
    const pickup = String(body.pickup ?? "").trim();
    const destination = String(body.destination ?? "").trim();

    if (!patientName || !contact || !pickup || !destination)
      throw new ApiError(
        "patientName, contact, pickup and destination are required",
        400
      );
    if (!EMERGENCY_TYPES.includes(emergencyType))
      throw new ApiError("Invalid emergencyType", 400);
    if (!PRIORITIES.includes(priority))
      throw new ApiError("Invalid priority", 400);

    // requestRef M-1001, M-1002, … — loop while exists
    const count = await this.missionRepository.countMissions();
    let n = 1000 + count + 1;
    let requestRef = "";
    for (;;) {
      requestRef = `M-${n}`;
      const clash = await this.missionRepository.findMissionByRequestRef(requestRef);
      if (!clash) break;
      n += 1;
    }

    // simulated green-corridor route: 4 segments with a guaranteed congestion mix
    // (1 GRIDLOCK + 1 HEAVY + 1 MODERATE + 1 LOW in random order) so every
    // mission demonstrates the alert mesh fallback ladder.
    const shuffled = [...SEGMENT_POOL].sort(() => Math.random() - 0.5);
    const mix = ["GRIDLOCK", "HEAVY", "MODERATE", "LOW"].sort(
      () => Math.random() - 0.5
    );
    const segments = shuffled.slice(0, 4).map((name, i) => ({
      name,
      congestion: mix[i],
      lengthKm: Math.round((0.8 + Math.random() * 2.4) * 10) / 10,
    }));
    const totalKm = segments.reduce((s, seg) => s + seg.lengthKm, 0);
    const etaMin = Math.round((totalKm / 11) * 60 + 5);

    const mission = await this.missionRepository.createMission({
      requestRef,
      patientName,
      contact,
      emergencyType,
      priority,
      pickup,
      destination,
      status: "REQUESTED",
      route: Array.isArray(body.route) && body.route.length > 0
        ? JSON.stringify(
            body.route.map((r: Record<string, unknown>) => ({
              name: String(r.name ?? "Segment"),
              congestion: ["LOW","MODERATE","HEAVY","GRIDLOCK"].includes(String(r.congestion)) ? String(r.congestion) : "MODERATE",
              lengthKm: Number(r.lengthKm) || 2,
            }))
          )
        : JSON.stringify(segments),
      etaMin,
    });

    log.info("mission_created", {
      missionId: mission.id,
      requestRef,
      emergencyType,
      priority,
      etaMin,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "MISSION_CREATE",
      "Mission",
      `${requestRef} · ${patientName} (${emergencyType})`,
      actor.userId
    );
    return mission;
  }

  /**
   * PATCH /api/missions/:id (ADMIN | VOLUNTEER)
   * Two compatible bodies:
   *  1. {status, progress?}            — status-stepper advance (auto progress 10/40/70/95/100)
   *  2. {action: dispatch|advance|complete|cancel, ambulanceId?} — legacy simulation flow
   *     ("dispatch" generates the 4-segment corridor + alert events, arms the corridor
   *      and flips the ambulance to ON_MISSION).
   */
  async update(id: string, body: UpdateMissionBody, actor: Session): Promise<MissionMutationResult> {
    const mission = await this.missionRepository.findMissionById(id);
    if (!mission) {
      log.warn("mission_not_found", { missionId: id, actor: actor.userId });
      throw new ApiError("Mission not found", 404);
    }

    // ── status-stepper flow ────────────────────────────────────────────────
    const rawStatus =
      body.status === undefined || body.status === null
        ? null
        : String(body.status).trim().toUpperCase();

    if (rawStatus) {
      if (!FLOW.includes(rawStatus) && rawStatus !== "CANCELLED")
        throw new ApiError(
          `status must be one of ${FLOW.join(", ")} or CANCELLED`,
          400
        );
      if (["COMPLETED", "CANCELLED"].includes(mission.status)) {
        log.warn("mission_already_closed", {
          missionId: id,
          requestRef: mission.requestRef,
          status: mission.status,
          requested: rawStatus,
          actor: actor.userId,
        });
        throw new ApiError("Mission already closed", 409);
      }

      if (rawStatus === mission.status)
        return { mission: { ...mission } };

      if (rawStatus === "CANCELLED") {
        const updated = await this.missionRepository.updateMissionWithAmbulance(id, {
          status: "CANCELLED",
          corridorActive: false,
        });
        if (mission.ambulanceId) {
          await this.missionRepository.updateAmbulanceStatus(mission.ambulanceId, "AVAILABLE");
        }
        log.info("mission_cancelled", {
          missionId: id,
          requestRef: mission.requestRef,
          via: "status",
          actor: actor.userId,
        });
        await logActivity(
          actor.name,
          "MISSION_CANCEL",
          "Mission",
          mission.requestRef,
          actor.userId
        );
        return { mission: updated };
      }

      // forward-only along the flow
      const from = FLOW.indexOf(mission.status);
      const to = FLOW.indexOf(rawStatus);
      if (to !== from + 1) {
        log.warn("mission_invalid_transition", {
          missionId: id,
          requestRef: mission.requestRef,
          from: mission.status,
          to: rawStatus,
          actor: actor.userId,
        });
        throw new ApiError(
          `Cannot move mission from ${mission.status} to ${rawStatus}`,
          409
        );
      }
      if (rawStatus === "DISPATCHED") {
        log.warn("mission_dispatch_requires_action", {
          missionId: id,
          requestRef: mission.requestRef,
          actor: actor.userId,
        });
        throw new ApiError(
          "Dispatch the mission with action:dispatch so the ambulance and corridor are activated together",
          409
        );
      }

      let progress = PROGRESS[rawStatus] ?? 0;
      if (body.progress !== undefined) {
        const p = Math.trunc(Number(body.progress));
        if (Number.isFinite(p)) progress = Math.min(100, Math.max(0, p));
      }

      const updated = await this.missionRepository.updateMissionWithAmbulance(id, {
        status: rawStatus,
        progress,
        ...(rawStatus === "COMPLETED" ? { corridorActive: false } : {}),
      });
      if (rawStatus === "COMPLETED" && mission.ambulanceId) {
        await this.missionRepository.updateAmbulanceStatus(mission.ambulanceId, "AVAILABLE");
      }
      if (rawStatus === "DISPATCHED" && mission.contact) sendDispatchSms(mission);
      log.info("mission_status_advanced", {
        missionId: id,
        requestRef: mission.requestRef,
        from: mission.status,
        to: rawStatus,
        progress,
        actor: actor.userId,
      });
      await logActivity(
        actor.name,
        "MISSION_STATUS",
        "Mission",
        `${mission.requestRef} → ${rawStatus} (${progress}%)`,
        actor.userId
      );
      return { mission: updated };
    }

    // ── legacy action flow ─────────────────────────────────────────────────
    const action = String(body.action ?? "").trim().toLowerCase();

    if (action === "dispatch") {
      if (mission.status !== "REQUESTED") {
        log.warn("mission_dispatch_not_requested", {
          missionId: id,
          requestRef: mission.requestRef,
          status: mission.status,
          actor: actor.userId,
        });
        throw new ApiError("Mission is not awaiting dispatch", 409);
      }
      const ambulanceId = String(body.ambulanceId ?? "").trim();
      if (!ambulanceId)
        throw new ApiError("ambulanceId is required to dispatch", 400);
      const ambulance = await this.missionRepository.findAmbulanceById(ambulanceId);
      if (!ambulance) {
        log.warn("mission_dispatch_ambulance_not_found", {
          missionId: id,
          requestRef: mission.requestRef,
          ambulanceId,
          actor: actor.userId,
        });
        throw new ApiError("Ambulance not found", 404);
      }
      if (ambulance.status !== "AVAILABLE") {
        log.warn("mission_dispatch_ambulance_unavailable", {
          missionId: id,
          requestRef: mission.requestRef,
          ambulanceId,
          ambulanceCode: ambulance.code,
          status: ambulance.status,
          actor: actor.userId,
        });
        throw new ApiError("Ambulance is not available", 409);
      }

      // generate corridor events for congested segments of the planned route
      let route: RouteSegment[] = [];
      try {
        route = JSON.parse(mission.route ?? "[]") as RouteSegment[];
      } catch {
        route = [];
      }
      // Legacy/seeded missions may lack a route — synthesise one so the corridor still arms.
      if (!Array.isArray(route) || route.length === 0) {
        log.debug("mission_route_synthesised", {
          missionId: id,
          requestRef: mission.requestRef,
          actor: actor.userId,
        });
        const pool = [
          "Hebbal Flyover", "Outer Ring Road", "Silk Board Junction",
          "KR Puram Junction", "Tin Factory", "Marathahalli Bridge",
          "NICE Road", "Majestic Interchange",
        ];
        const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, 4);
        const mix = ["GRIDLOCK", "HEAVY", "MODERATE", "LOW"].sort(
          () => Math.random() - 0.5
        );
        route = picked.map((name, i) => ({
          name,
          congestion: mix[i],
          lengthKm: Math.round((0.8 + Math.random() * 2.4) * 10) / 10,
        }));
      }
      const eventsData: CorridorEventCreateData[] = [];

      for (const seg of route) {
        if (seg.congestion === "LOW") continue;
        if (seg.congestion === "GRIDLOCK") {
          eventsData.push({
            missionId: id,
            segment: seg.name,
            method: "V2X_5G",
            congestion: seg.congestion,
            vehiclesAlerted: randInt(140, 220),
            timeSavedSec: randInt(280, 420),
            note: "BLE_MESH fallback relayed to offline vehicles",
          });
        } else if (seg.congestion === "HEAVY") {
          eventsData.push({
            missionId: id,
            segment: seg.name,
            method: "CELL_BROADCAST",
            congestion: seg.congestion,
            vehiclesAlerted: randInt(80, 140),
            timeSavedSec: randInt(140, 240),
            note: "Cell broadcast alert pushed to all phones along the corridor",
          });
        } else {
          // MODERATE
          eventsData.push({
            missionId: id,
            segment: seg.name,
            method: "BLE_MESH",
            congestion: seg.congestion,
            vehiclesAlerted: randInt(30, 60),
            timeSavedSec: randInt(40, 80),
            note: "Mesh hop relay across connected vehicle cluster",
          });
        }
      }
      if (eventsData.length > 0)
        await this.missionRepository.createCorridorEvents(eventsData);

      const vehiclesAlerted = eventsData.reduce((s, e) => s + e.vehiclesAlerted, 0);
      const timeSavedSec = eventsData.reduce((s, e) => s + e.timeSavedSec, 0);
      const etaMin = Math.max(
        3,
        Math.round((mission.etaMin ?? 0) - timeSavedSec / 60)
      );

      await this.missionRepository.updateAmbulanceStatus(ambulanceId, "ON_MISSION");
      const updated = await this.missionRepository.updateMission(id, {
        status: "DISPATCHED",
        ambulanceId,
        corridorActive: true,
        vehiclesAlerted,
        timeSavedSec,
        etaMin,
        route: JSON.stringify(route),
      });
      const events = await this.missionRepository.listCorridorEvents(id);

      if (mission.contact) sendDispatchSms(mission);
      log.info("mission_dispatched", {
        missionId: id,
        requestRef: mission.requestRef,
        ambulanceId,
        ambulanceCode: ambulance.code,
        vehiclesAlerted,
        timeSavedSec,
        etaMin,
        corridorEvents: eventsData.length,
        actor: actor.userId,
      });
      await logActivity(
        actor.name,
        "MISSION_DISPATCH",
        "Mission",
        `${mission.requestRef} → ${ambulance.code}`,
        actor.userId
      );
      return { mission: { ...updated, ambulance, events }, ambulance };
    }

    if (action === "advance") {
      if (["REQUESTED", "COMPLETED", "CANCELLED"].includes(mission.status)) {
        log.warn("mission_advance_blocked", {
          missionId: id,
          requestRef: mission.requestRef,
          status: mission.status,
          actor: actor.userId,
        });
        throw new ApiError("Mission cannot be advanced", 409);
      }
      const progress = Math.min(100, mission.progress + 25);
      const status = progress >= 100 ? "ARRIVED" : "EN_ROUTE";
      const updated = await this.missionRepository.updateMissionWithAmbulance(id, {
        progress,
        status,
      });
      log.info("mission_advanced", {
        missionId: id,
        requestRef: mission.requestRef,
        status,
        progress,
        actor: actor.userId,
      });
      await logActivity(
        actor.name,
        "MISSION_ADVANCE",
        "Mission",
        `${mission.requestRef} → ${status} (${progress}%)`,
        actor.userId
      );
      return { mission: updated };
    }

    if (action === "complete") {
      if (["REQUESTED", "CANCELLED", "COMPLETED"].includes(mission.status)) {
        log.warn("mission_complete_blocked", {
          missionId: id,
          requestRef: mission.requestRef,
          status: mission.status,
          actor: actor.userId,
        });
        throw new ApiError("Mission cannot be completed from its current state", 409);
      }
      const updated = await this.missionRepository.updateMissionWithAmbulance(id, {
        status: "COMPLETED",
        progress: 100,
        corridorActive: false,
      });
      if (mission.ambulanceId) {
        await this.missionRepository.updateAmbulanceStatus(mission.ambulanceId, "AVAILABLE");
      }
      log.info("mission_completed", {
        missionId: id,
        requestRef: mission.requestRef,
        actor: actor.userId,
      });
      await logActivity(
        actor.name,
        "MISSION_COMPLETE",
        "Mission",
        mission.requestRef,
        actor.userId
      );
      return { mission: updated };
    }

    if (action === "cancel") {
      if (["COMPLETED", "CANCELLED"].includes(mission.status)) {
        log.warn("mission_cancel_blocked", {
          missionId: id,
          requestRef: mission.requestRef,
          status: mission.status,
          actor: actor.userId,
        });
        throw new ApiError("Mission already closed", 409);
      }
      const updated = await this.missionRepository.updateMissionWithAmbulance(id, {
        status: "CANCELLED",
        corridorActive: false,
      });
      if (mission.ambulanceId) {
        await this.missionRepository.updateAmbulanceStatus(mission.ambulanceId, "AVAILABLE");
      }
      log.info("mission_cancelled", {
        missionId: id,
        requestRef: mission.requestRef,
        via: "action",
        actor: actor.userId,
      });
      await logActivity(
        actor.name,
        "MISSION_CANCEL",
        "Mission",
        mission.requestRef,
        actor.userId
      );
      return { mission: updated };
    }

    throw new ApiError("action must be dispatch, advance, complete or cancel", 400);
  }
}
