import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

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

// GET /api/missions?status=&q= (auth) — latest 50
export async function GET(req: Request) {
  try {
    await requireAuth();
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status") || undefined;
    const q = sp.get("q")?.trim() || undefined;

    const where: Prisma.MissionWhereInput = {};
    if (status) where.status = status;
    if (q)
      where.OR = [
        { patientName: { contains: q } },
        { pickup: { contains: q } },
      ];

    const missions = await db.mission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        ambulance: { select: { code: true, type: true, driverName: true } },
      },
    });
    return json(missions);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/missions (ADMIN | VOLUNTEER) — generates a 4-segment simulated route
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

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
        route: JSON.stringify(segments),
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
    return json(mission, 201);
  } catch (e) {
    return handleError(e);
  }
}
