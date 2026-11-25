/**
 * Missions routes — /api/missions, /api/missions/:id
 * Converted 1:1 from src/app/api/missions/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { loadSettings, sendSms } from "@/lib/notify";
import { MISSION_FLOW, MISSION_PROGRESS } from "@/lib/missions";

export const router = Router();

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

function pickCongestion(): string {
  const r = Math.random();
  if (r < 0.3) return "LOW";
  if (r < 0.6) return "MODERATE";
  if (r < 0.85) return "HEAVY";
  return "GRIDLOCK";
}

/** Fire-and-forget dispatch SMS to the requester (sendSms no-ops when disabled). */
function sendDispatchSms(m: {
  contact: string;
  patientName: string;
  pickup: string;
  destination: string;
}) {
  void (async () => {
    try {
      const map = await loadSettings();
      const out = await sendSms(map, {
        to: m.contact,
        text: `UAR green corridor: ambulance dispatched for ${m.patientName}. Pickup ${m.pickup} → ${m.destination}. Track in the app.`,
      });
      if (out && !out.ok && !out.skipped)
        console.error("[notify] dispatch SMS failed:", out.message);
    } catch (e) {
      console.error("[notify] dispatch SMS failed", e);
    }
  })();
}

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Canonical status flow (CANCELLED is a side-state allowed from any open state)
// and auto progress — single source of truth in @/lib/missions, shared with the
// admin ambulance view's stepper.
const FLOW: readonly string[] = MISSION_FLOW;
const PROGRESS: Record<string, number> = MISSION_PROGRESS;

// GET /api/missions?status=&q=&ambulanceId=&limit= (auth) — newest first
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
    const status = sp.get("status") || undefined;
    const q = sp.get("q")?.trim() || undefined;
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(sp.get("limit")) || 200)));

    const where: Prisma.MissionWhereInput = {};
    const ambulanceId = sp.get("ambulanceId");
    if (ambulanceId) where.ambulanceId = ambulanceId;
    if (status) where.status = status;
    if (q)
      where.OR = [
        { requestRef: { contains: q } },
        { patientName: { contains: q } },
        { pickup: { contains: q } },
      ];

    const missions = await db.mission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        ambulance: { select: { code: true, type: true, driverName: true } },
      },
    });
    return json(res, missions);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/missions (ADMIN | VOLUNTEER) — generates a 4-segment simulated route
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const body = (req.body ?? {}) as Record<string, unknown>;

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
    const count = await db.mission.count();
    let n = 1000 + count + 1;
    let requestRef = "";
    for (;;) {
      requestRef = `M-${n}`;
      const clash = await db.mission.findUnique({ where: { requestRef } });
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

    const mission = await db.mission.create({
      data: {
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
      },
    });

    await logActivity(
      session.name,
      "MISSION_CREATE",
      "Mission",
      `${requestRef} · ${patientName} (${emergencyType})`,
      session.userId
    );
    return json(res, mission, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/missions/:id (ADMIN | VOLUNTEER)
// Two compatible bodies:
//  1. {status, progress?}            — status-stepper advance (auto progress 10/40/70/95/100)
//  2. {action: dispatch|advance|complete|cancel, ambulanceId?} — legacy simulation flow
//     ("dispatch" generates the 4-segment corridor + alert events, arms the corridor
//      and flips the ambulance to ON_MISSION).
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const mission = await db.mission.findUnique({ where: { id } });
    if (!mission) throw new ApiError("Mission not found", 404);

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
      if (["COMPLETED", "CANCELLED"].includes(mission.status))
        throw new ApiError("Mission already closed", 409);

      if (rawStatus === mission.status)
        return json(res, { mission: { ...mission } });

      if (rawStatus === "CANCELLED") {
        const updated = await db.mission.update({
          where: { id },
          data: { status: "CANCELLED", corridorActive: false },
          include: { ambulance: true },
        });
        if (mission.ambulanceId) {
          await db.ambulance.update({
            where: { id: mission.ambulanceId },
            data: { status: "AVAILABLE" },
          });
        }
        await logActivity(
          session.name,
          "MISSION_CANCEL",
          "Mission",
          mission.requestRef,
          session.userId
        );
        return json(res, { mission: updated });
      }

      // forward-only along the flow
      const from = FLOW.indexOf(mission.status);
      const to = FLOW.indexOf(rawStatus);
      if (to !== from + 1)
        throw new ApiError(
          `Cannot move mission from ${mission.status} to ${rawStatus}`,
          409
        );
      if (rawStatus === "DISPATCHED")
        throw new ApiError(
          "Dispatch the mission with action:dispatch so the ambulance and corridor are activated together",
          409
        );

      let progress = PROGRESS[rawStatus] ?? 0;
      if (body.progress !== undefined) {
        const p = Math.trunc(Number(body.progress));
        if (Number.isFinite(p)) progress = Math.min(100, Math.max(0, p));
      }

      const updated = await db.mission.update({
        where: { id },
        data: {
          status: rawStatus,
          progress,
          ...(rawStatus === "COMPLETED" ? { corridorActive: false } : {}),
        },
        include: { ambulance: true },
      });
      if (rawStatus === "COMPLETED" && mission.ambulanceId) {
        await db.ambulance.update({
          where: { id: mission.ambulanceId },
          data: { status: "AVAILABLE" },
        });
      }
      if (rawStatus === "DISPATCHED" && mission.contact) sendDispatchSms(mission);
      await logActivity(
        session.name,
        "MISSION_STATUS",
        "Mission",
        `${mission.requestRef} → ${rawStatus} (${progress}%)`,
        session.userId
      );
      return json(res, { mission: updated });
    }

    // ── legacy action flow ─────────────────────────────────────────────────
    const action = String(body.action ?? "").trim().toLowerCase();

    if (action === "dispatch") {
      if (mission.status !== "REQUESTED")
        throw new ApiError("Mission is not awaiting dispatch", 409);
      const ambulanceId = String(body.ambulanceId ?? "").trim();
      if (!ambulanceId)
        throw new ApiError("ambulanceId is required to dispatch", 400);
      const ambulance = await db.ambulance.findUnique({
        where: { id: ambulanceId },
      });
      if (!ambulance) throw new ApiError("Ambulance not found", 404);
      if (ambulance.status !== "AVAILABLE")
        throw new ApiError("Ambulance is not available", 409);

      // generate corridor events for congested segments of the planned route
      let route: RouteSegment[] = [];
      try {
        route = JSON.parse(mission.route ?? "[]") as RouteSegment[];
      } catch {
        route = [];
      }
      // Legacy/seeded missions may lack a route — synthesise one so the corridor still arms.
      if (!Array.isArray(route) || route.length === 0) {
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
      const eventsData: {
        missionId: string;
        segment: string;
        method: string;
        congestion: string;
        vehiclesAlerted: number;
        timeSavedSec: number;
        note: string;
      }[] = [];

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
        await db.corridorEvent.createMany({ data: eventsData });

      const vehiclesAlerted = eventsData.reduce((s, e) => s + e.vehiclesAlerted, 0);
      const timeSavedSec = eventsData.reduce((s, e) => s + e.timeSavedSec, 0);
      const etaMin = Math.max(
        3,
        Math.round((mission.etaMin ?? 0) - timeSavedSec / 60)
      );

      await db.ambulance.update({
        where: { id: ambulanceId },
        data: { status: "ON_MISSION" },
      });
      const updated = await db.mission.update({
        where: { id },
        data: {
          status: "DISPATCHED",
          ambulanceId,
          corridorActive: true,
          vehiclesAlerted,
          timeSavedSec,
          etaMin,
          route: JSON.stringify(route),
        },
      });
      const events = await db.corridorEvent.findMany({
        where: { missionId: id },
        orderBy: { createdAt: "desc" },
      });

      if (mission.contact) sendDispatchSms(mission);
      await logActivity(
        session.name,
        "MISSION_DISPATCH",
        "Mission",
        `${mission.requestRef} → ${ambulance.code}`,
        session.userId
      );
      return json(res, { mission: { ...updated, ambulance, events }, ambulance });
    }

    if (action === "advance") {
      if (["REQUESTED", "COMPLETED", "CANCELLED"].includes(mission.status))
        throw new ApiError("Mission cannot be advanced", 409);
      const progress = Math.min(100, mission.progress + 25);
      const status = progress >= 100 ? "ARRIVED" : "EN_ROUTE";
      const updated = await db.mission.update({
        where: { id },
        data: { progress, status },
        include: { ambulance: true },
      });
      await logActivity(
        session.name,
        "MISSION_ADVANCE",
        "Mission",
        `${mission.requestRef} → ${status} (${progress}%)`,
        session.userId
      );
      return json(res, { mission: updated });
    }

    if (action === "complete") {
      if (["REQUESTED", "CANCELLED", "COMPLETED"].includes(mission.status))
        throw new ApiError("Mission cannot be completed from its current state", 409);
      const updated = await db.mission.update({
        where: { id },
        data: { status: "COMPLETED", progress: 100, corridorActive: false },
        include: { ambulance: true },
      });
      if (mission.ambulanceId) {
        await db.ambulance.update({
          where: { id: mission.ambulanceId },
          data: { status: "AVAILABLE" },
        });
      }
      await logActivity(
        session.name,
        "MISSION_COMPLETE",
        "Mission",
        mission.requestRef,
        session.userId
      );
      return json(res, { mission: updated });
    }

    if (action === "cancel") {
      if (["COMPLETED", "CANCELLED"].includes(mission.status))
        throw new ApiError("Mission already closed", 409);
      const updated = await db.mission.update({
        where: { id },
        data: { status: "CANCELLED", corridorActive: false },
        include: { ambulance: true },
      });
      if (mission.ambulanceId) {
        await db.ambulance.update({
          where: { id: mission.ambulanceId },
          data: { status: "AVAILABLE" },
        });
      }
      await logActivity(
        session.name,
        "MISSION_CANCEL",
        "Mission",
        mission.requestRef,
        session.userId
      );
      return json(res, { mission: updated });
    }

    throw new ApiError("action must be dispatch, advance, complete or cancel", 400);
  } catch (e) {
    return handleError(e, res);
  }
});
