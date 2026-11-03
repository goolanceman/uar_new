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

function parseFrom(sp: URLSearchParams): Date | undefined {
  const raw = sp.get("from")?.trim();
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseTo(sp: URLSearchParams): Date | undefined {
  const raw = sp.get("to")?.trim();
  if (!raw) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999` : raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function buildWhere(sp: URLSearchParams): Prisma.PadDistributionWhereInput {
  const where: Prisma.PadDistributionWhereInput = {};

  const q = sp.get("q")?.trim();
  if (q)
    where.OR = [
      { schoolName: { contains: q } },
      { area: { contains: q } },
      { volunteerName: { contains: q } },
      { notes: { contains: q } },
    ];

  const session = sp.get("session");
  if (session === "1") where.awarenessSession = true;
  else if (session === "0") where.awarenessSession = false;

  const from = parseFrom(sp);
  const to = parseTo(sp);
  if (from || to)
    where.distributionDate = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };

  const volunteerId = sp.get("volunteerId")?.trim();
  if (volunteerId) where.volunteerId = volunteerId;

  return where;
}

// GET /api/pad-distributions
//   ?q= &session=1|0 &from= &to= &volunteerId= &limit= &offset= &withTotals=1   (auth)
// Default = raw array (legacy). withTotals=1 → {items,total,sumPads,sumGirls,…}
export async function GET(req: Request) {
  try {
    await requireAuth();
    const sp = new URL(req.url).searchParams;
    const where = buildWhere(sp);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(sp.get("limit")) || 100)));
    const offset = Math.max(0, Math.trunc(Number(sp.get("offset")) || 0));
    const withTotals = sp.get("withTotals") === "1";

    const [rows, total] = await Promise.all([
      db.padDistribution.findMany({
        where,
        orderBy: { distributionDate: "desc" },
        take: limit,
        skip: offset,
      }),
      db.padDistribution.count({ where }),
    ]);

    // PadDistribution has volunteerId but no Prisma relation — attach manually.
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

    const items = rows.map((r) => ({
      ...r,
      volunteer: r.volunteerId ? volunteerMap.get(r.volunteerId) ?? null : null,
    }));

    if (!withTotals) return json(items);

    const [agg, sessionAgg, schoolRows] = await Promise.all([
      db.padDistribution.aggregate({
        where,
        _sum: { padsDistributed: true, girlsCount: true, sessionAttendees: true },
      }),
      db.padDistribution.count({ where: { ...where, awarenessSession: true } }),
      db.padDistribution.findMany({
        where,
        distinct: ["schoolName"],
        select: { schoolName: true },
      }),
    ]);

    return json({
      items,
      total,
      count: total,
      sumPads: agg._sum.padsDistributed ?? 0,
      sumGirls: agg._sum.girlsCount ?? 0,
      sumAttendees: agg._sum.sessionAttendees ?? 0,
      sessions: sessionAgg,
      schools: schoolRows.filter((s) => s.schoolName).length,
    });
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

    // Explicit volunteerId (admin assignment) wins; else session profile.
    let volunteerId: string | null = null;
    if (body.volunteerId) {
      const assigned = await db.volunteer.findUnique({
        where: { id: String(body.volunteerId) },
      });
      if (!assigned) throw new ApiError("Volunteer not found", 400);
      volunteerId = assigned.id;
    } else {
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      volunteerId = volunteer?.id ?? null;
    }

    const row = await db.padDistribution.create({
      data: {
        schoolName: body.schoolName ? String(body.schoolName).trim() : null,
        area,
        girlsCount,
        padsDistributed,
        awarenessSession,
        sessionAttendees,
        notes: body.notes ? String(body.notes) : null,
        volunteerId,
        volunteerName: body.volunteerName ? String(body.volunteerName).trim() : (volunteerId ? null : session.name),
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
