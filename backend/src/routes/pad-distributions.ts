/**
 * Pad distribution (pad drive) routes — /api/pad-distributions, /:id
 * Converted 1:1 from src/app/api/pad-distributions/* to Express.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const router = Router();

const log = logger.child("pad-distributions");

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
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
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

    if (!withTotals) return json(res, items);

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

    return json(res, {
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
    return handleError(e, res);
  }
});

// POST /api/pad-distributions (VOLUNTEER | ADMIN)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "VOLUNTEER", "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

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
      if (!assigned) {
        log.warn("pad_drive_volunteer_not_found", { volunteerId: body.volunteerId, actor: session.userId });
        throw new ApiError("Volunteer not found", 400);
      }
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

    log.info("pad_drive_created", {
      padDistributionId: row.id,
      area,
      padsDistributed,
      girlsCount,
      awarenessSession,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "PAD_DRIVE",
      "PadDistribution",
      `${area} · ${padsDistributed} pads · ${girlsCount} girls`,
      session.userId
    );
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

/** ADMIN may edit anything; VOLUNTEER only drives attributed to them. */
async function assertCanMutate(
  session: { role: string; userId: string },
  id: string
) {
  const existing = await db.padDistribution.findUnique({
    where: { id },
    select: { id: true, volunteerId: true, area: true, padsDistributed: true },
  });
  if (!existing) {
    log.warn("pad_drive_not_found", { padDistributionId: id, actor: session.userId });
    throw new ApiError("Pad distribution not found", 404);
  }
  if (session.role !== "ADMIN") {
    const own = await db.volunteer.findUnique({
      where: { userId: session.userId },
      select: { id: true },
    });
    if (!own || existing.volunteerId !== own.id) {
      log.warn("pad_drive_not_owner", {
        padDistributionId: id,
        area: existing.area,
        actor: session.userId,
      });
      throw new ApiError("You can only manage pad drives you recorded", 403);
    }
  }
  return existing;
}

// GET /api/pad-distributions/:id (auth) — detail with volunteer name
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const row = await db.padDistribution.findUnique({ where: { id } });
    if (!row) throw new ApiError("Pad distribution not found", 404);

    let volunteer: { id: string; name: string } | null = null;
    if (row.volunteerId) {
      const v = await db.volunteer.findUnique({
        where: { id: row.volunteerId },
        select: { id: true, user: { select: { name: true } } },
      });
      if (v) volunteer = { id: v.id, name: v.user.name };
    }
    return json(res, { ...row, volunteer });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/pad-distributions/:id (ADMIN, or the recording VOLUNTEER)
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    await assertCanMutate(session, id);

    const data: Prisma.PadDistributionUncheckedUpdateInput = {};
    if (body.schoolName !== undefined)
      data.schoolName = body.schoolName ? String(body.schoolName).trim() : null;
    if (body.area !== undefined) {
      const area = String(body.area).trim();
      if (!area) throw new ApiError("area cannot be empty", 400);
      data.area = area;
    }
    if (body.girlsCount !== undefined)
      data.girlsCount = Math.max(0, Math.trunc(Number(body.girlsCount)) || 0);
    if (body.padsDistributed !== undefined)
      data.padsDistributed = Math.max(
        0,
        Math.trunc(Number(body.padsDistributed)) || 0
      );
    if (body.awarenessSession !== undefined)
      data.awarenessSession = Boolean(body.awarenessSession);
    if (body.sessionAttendees !== undefined)
      data.sessionAttendees =
        body.sessionAttendees === null || body.sessionAttendees === ""
          ? null
          : Math.max(0, Math.trunc(Number(body.sessionAttendees)) || 0);
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
    if (body.volunteerName !== undefined)
      data.volunteerName = body.volunteerName ? String(body.volunteerName).trim() : null;
    if (body.distributionDate !== undefined) {
      const d = new Date(String(body.distributionDate));
      if (Number.isNaN(d.getTime()))
        throw new ApiError("Invalid distributionDate", 400);
      data.distributionDate = d;
    }
    if (body.volunteerId !== undefined) {
      if (!body.volunteerId) data.volunteerId = null;
      else {
        const v = await db.volunteer.findUnique({
          where: { id: String(body.volunteerId) },
        });
        if (!v) {
          log.warn("pad_drive_volunteer_not_found", { volunteerId: body.volunteerId, padDistributionId: id, actor: session.userId });
          throw new ApiError("Volunteer not found", 400);
        }
        data.volunteerId = v.id;
      }
    }

    const row = await db.padDistribution.update({ where: { id }, data });
    log.info("pad_drive_updated", {
      padDistributionId: id,
      area: row.area,
      padsDistributed: row.padsDistributed,
      fields: Object.keys(data),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "PAD_DRIVE_UPDATE",
      "PadDistribution",
      id,
      session.userId
    );
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/pad-distributions/:id (ADMIN, or the recording VOLUNTEER)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const existing = await assertCanMutate(session, id);

    await db.padDistribution.delete({ where: { id } });
    log.info("pad_drive_deleted", {
      padDistributionId: id,
      area: existing.area,
      padsDistributed: existing.padsDistributed,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "PAD_DRIVE_DELETE",
      "PadDistribution",
      `${existing.area} · ${existing.padsDistributed} pads`,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
