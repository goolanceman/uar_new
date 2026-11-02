import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
type RouteSegment = { name: string; congestion: string; lengthKm: number };

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// PATCH /api/missions/:id (ADMIN | VOLUNTEER) — {action: dispatch|advance|complete|cancel, ambulanceId?}
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim().toLowerCase();

    const mission = await db.mission.findUnique({ where: { id } });
    if (!mission) throw new ApiError("Mission not found", 404);

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

      await logActivity(
        session.name,
        "MISSION_DISPATCH",
        "Mission",
        `${mission.requestRef} → ${ambulance.code}`,
        session.userId
      );
      return json({ mission: { ...updated, ambulance, events }, ambulance });
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
      return json({ mission: updated });
    }

    if (action === "complete") {
      if (["REQUESTED", "CANCELLED", "COMPLETED"].includes(mission.status))
        throw new ApiError("Mission cannot be completed from its current state", 409);
      const updated = await db.mission.update({
        where: { id },
        data: { status: "COMPLETED", progress: 100 },
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
      return json({ mission: updated });
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
      return json({ mission: updated });
    }

    throw new ApiError("action must be dispatch, advance, complete or cancel", 400);
  } catch (e) {
    return handleError(e);
  }
}
