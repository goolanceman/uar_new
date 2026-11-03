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

// GET /api/pad-distributions?q= (auth)
export async function GET(req: Request) {
  try {
    await requireAuth();
    const sp = new URL(req.url).searchParams;
    const q = sp.get("q")?.trim() || undefined;

    const where: Prisma.PadDistributionWhereInput = {};
    if (q)
      where.OR = [
        { schoolName: { contains: q } },
        { area: { contains: q } },
      ];

    const rows = await db.padDistribution.findMany({
      where,
      orderBy: { distributionDate: "desc" },
    });

    // PadDistribution has volunteerId but no Prisma relation — attach volunteer info manually
    const volunteerIds = Array.from(
      new Set(rows.map((r) => r.volunteerId).filter((v): v is string => Boolean(v)))
    );
    const volunteers = volunteerIds.length
      ? await db.volunteer.findMany({
          where: { id: { in: volunteerIds } },
          select: { id: true, user: { select: { name: true } } },
        })
      : [];
    const volunteerMap = new Map(
      volunteers.map((v) => [v.id, { id: v.id, name: v.user.name }])
    );

    return json(
      rows.map((r) => ({
        ...r,
        volunteer: r.volunteerId ? volunteerMap.get(r.volunteerId) ?? null : null,
      }))
    );
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/pad-distributions (VOLUNTEER | ADMIN)
export async function POST(req: Request) {
  try {
    const session = await requireRole("VOLUNTEER", "ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const area = String(body.area ?? "").trim();
    if (!area) throw new ApiError("area is required", 400);

    const girlsCount = Math.max(0, Math.trunc(Number(body.girlsCount ?? 0)) || 0);
    const padsDistributed = Math.max(
      0,
      Math.trunc(Number(body.padsDistributed ?? 0)) || 0
    );
    const awarenessSession = Boolean(body.awarenessSession);
    const sessionAttendees =
      body.sessionAttendees !== undefined &&
      body.sessionAttendees !== null &&
      body.sessionAttendees !== ""
        ? Math.max(0, Math.trunc(Number(body.sessionAttendees)) || 0)
        : null;

    const distributionDateRaw = body.distributionDate
      ? new Date(String(body.distributionDate))
      : new Date();
    const distributionDate = Number.isNaN(distributionDateRaw.getTime())
      ? new Date()
      : distributionDateRaw;

    // attribute to the session's volunteer profile
    const volunteer = await db.volunteer.findUnique({
      where: { userId: session.userId },
    });

    const row = await db.padDistribution.create({
      data: {
        schoolName: body.schoolName ? String(body.schoolName).trim() : null,
        area,
        girlsCount,
        padsDistributed,
        awarenessSession,
        sessionAttendees,
        notes: body.notes ? String(body.notes) : null,
        volunteerId: volunteer?.id ?? null,
        volunteerName: body.volunteerName ? String(body.volunteerName).trim() : (volunteer ? null : session.name),
        distributionDate,
      },
    });

    await logActivity(
      session.name,
      "PAD_DRIVE",
      "PadDistribution",
      `${area} · ${padsDistributed} pads · ${girlsCount} girls`,
      session.userId
    );
    return json(row, 201);
  } catch (e) {
    return handleError(e);
  }
}
