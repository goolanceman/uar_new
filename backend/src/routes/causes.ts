/**
 * Causes routes — /api/causes, /api/causes/pledges, /api/causes/:id, /api/causes/:id/pledges
 * Converted 1:1 from src/app/api/causes/* (Next.js route handlers) to Express.
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
  validateSession,
} from "@/lib/session";
import { recomputeCause, CAUSE_STATUSES, CAUSE_TRANSITIONS } from "@/lib/causes";
import { pledgeSchedule, pledgeInstallments } from "@/lib/recurring";
import { assertTransition } from "@/lib/workflow";
import {
  cached,
  cacheKeyPart,
  cacheTtl,
  causeDetailKey,
  causesListKey,
  invalidateCauses,
} from "@/lib/cache";

export const router = Router();

const CONDITIONS = ["BP", "DIABETES", "THYROID", "CARDIAC", "ASTHMA", "ARTHRITIS", "OTHER"];

// GET /api/causes?condition=&status=&q= (public)
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const condition = sp.get("condition") || undefined;
    const status = sp.get("status") || undefined;
    const q = sp.get("q")?.trim() || undefined;

    const where: Prisma.CauseWhereInput = {};
    if (condition) where.condition = condition;
    if (status) where.status = status;
    if (q)
      where.OR = [
        { patientName: { contains: q } },
        { city: { contains: q } },
        { code: { contains: q } },
      ];

    const causes = await cached(
      causesListKey(cacheKeyPart({ condition, status, q })),
      cacheTtl.causes,
      () =>
        db.cause.findMany({
          where,
          orderBy: { createdAt: "desc" },
          include: {
            pledges: {
              where: { status: "ACTIVE" },
              select: {
                id: true,
                donorName: true,
                amountPerMonth: true,
                months: true,
                status: true,
              },
              orderBy: { createdAt: "asc" },
            },
          },
        })
    );
    return json(res, causes);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/causes/pledges?mine=1&causeId= (auth)
// NOTE: declared before any conflicting "/:id" pattern.
router.get("/pledges", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;

    const where: Prisma.PledgeWhereInput = {};
    if (sp.get("mine")) where.donorId = session.userId;
    const causeId = sp.get("causeId");
    if (causeId) where.causeId = causeId;

    const pledges = await db.pledge.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        cause: {
          select: {
            code: true,
            patientName: true,
            condition: true,
            monthlyCost: true,
          },
        },
      },
    });
    // Schedule/payment-tracking fields are additive — the flat pledge rows the
    // web portal and mobile app already parse keep their shape.
    const ids = pledges.map((p) => p.id);
    const payments = ids.length
      ? await db.donation.findMany({ where: { pledgeId: { in: ids } } })
      : [];
    return json(
      res,
      pledges.map((p) => {
        const mine = payments.filter((d) => d.pledgeId === p.id);
        return {
          ...p,
          ...pledgeSchedule(p, mine),
          installments: pledgeInstallments(mine),
        };
      })
    );
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/causes (ADMIN)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const patientName = String(body.patientName ?? "").trim();
    const city = String(body.city ?? "").trim();
    const condition = String(body.condition ?? "").trim().toUpperCase();
    const story = String(body.story ?? "").trim();
    const age = Math.trunc(Number(body.age));
    const monthlyCost = Number(body.monthlyCost);
    const durationMonths = Math.trunc(Number(body.durationMonths ?? 12));

    if (!patientName || !city || !story)
      throw new ApiError("patientName, city and story are required", 400);
    if (!Number.isFinite(age) || age <= 0)
      throw new ApiError("age must be a positive number", 400);
    if (!Number.isFinite(monthlyCost) || monthlyCost <= 0)
      throw new ApiError("monthlyCost must be a positive number", 400);
    if (!Number.isFinite(durationMonths) || durationMonths < 1)
      throw new ApiError("durationMonths must be at least 1", 400);
    if (!CONDITIONS.includes(condition))
      throw new ApiError("Invalid condition", 400);

    // code UAR-MED-0001 — loop while exists
    const count = await db.cause.count();
    let n = count + 1;
    let code = "";
    for (;;) {
      code = `UAR-MED-${String(n).padStart(4, "0")}`;
      const clash = await db.cause.findUnique({ where: { code } });
      if (!clash) break;
      n += 1;
    }

    const cause = await db.cause.create({
      data: {
        code,
        patientName,
        age,
        city,
        condition,
        monthlyCost,
        durationMonths,
        story,
      },
    });

    await logActivity(
      session.name,
      "CAUSE_CREATE",
      "Cause",
      `${cause.code} · ${patientName}`,
      session.userId
    );
    await invalidateCauses();
    return json(res, cause, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/causes/:id (public)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const cause = await cached(causeDetailKey(id), cacheTtl.causes, () =>
      db.cause.findUnique({
        where: { id },
        include: { pledges: { orderBy: { createdAt: "desc" } } },
      })
    );
    if (!cause) throw new ApiError("Cause not found", 404);
    return json(res, cause);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/causes/:id (ADMIN)
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const existing = await db.cause.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Cause not found", 404);

    const data: Prisma.CauseUpdateInput = {};
    if (body.patientName !== undefined)
      data.patientName = String(body.patientName).trim();
    if (body.age !== undefined) data.age = Math.trunc(Number(body.age));
    if (body.city !== undefined) data.city = String(body.city).trim();
    if (body.condition !== undefined)
      data.condition = String(body.condition).trim().toUpperCase();
    if (body.monthlyCost !== undefined) data.monthlyCost = Number(body.monthlyCost);
    if (body.durationMonths !== undefined)
      data.durationMonths = Math.trunc(Number(body.durationMonths));
    if (body.story !== undefined) data.story = String(body.story);
    const statusProvided = body.status !== undefined;
    if (statusProvided) {
      const s = String(body.status).trim().toUpperCase();
      if (!CAUSE_STATUSES.includes(s))
        throw new ApiError("status must be SEEKING, PARTIAL, ADOPTED or PAUSED", 400);
      assertTransition(CAUSE_TRANSITIONS, existing.status, s, "cause", 400);
      data.status = s;
    }

    await db.cause.update({ where: { id }, data });

    // If admin did not force a status, recompute it from the ACTIVE pledges.
    const cause = statusProvided
      ? await db.cause.findUnique({
          where: { id },
          include: { pledges: { orderBy: { createdAt: "desc" } } },
        })
      : await recomputeCause(id);

    await logActivity(
      session.name,
      "CAUSE_UPDATE",
      "Cause",
      `${existing.code}${statusProvided ? ` → ${String(body.status).toUpperCase()}` : ""}`,
      session.userId
    );
    await invalidateCauses();
    return json(res, cause);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/causes/:id (ADMIN)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.cause.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Cause not found", 404);

    await db.pledge.deleteMany({ where: { causeId: id } });
    await db.cause.delete({ where: { id } });

    await logActivity(
      session.name,
      "CAUSE_DELETE",
      "Cause",
      existing.code,
      session.userId
    );
    await invalidateCauses();
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/causes/:id/pledges — public (guests) OR authenticated donors
router.post("/:id/pledges", async (req, res) => {
  try {
    const { id } = req.params;
    const session = await validateSession(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const amountPerMonth = Number(body.amountPerMonth);
    const months = Math.trunc(Number(body.months ?? 6));
    if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0)
      throw new ApiError("amountPerMonth must be greater than 0", 400);
    if (!Number.isFinite(months) || months < 1)
      throw new ApiError("months must be at least 1", 400);

    const cause = await db.cause.findUnique({ where: { id } });
    if (!cause) throw new ApiError("Cause not found", 404);

    const donorName =
      String(body.donorName ?? "").trim() || session?.name || "Anonymous Donor";

    // The web portal and the app both send a start date for the mandate —
    // default to now when absent (legacy callers).
    let startDate = new Date();
    if (body.startDate) {
      const parsed = new Date(String(body.startDate));
      if (Number.isNaN(parsed.getTime()))
        throw new ApiError("startDate is not a valid date", 400);
      startDate = parsed;
    }

    const pledge = await db.pledge.create({
      data: {
        causeId: id,
        donorId: session?.userId ?? null,
        donorName,
        amountPerMonth,
        months,
        startDate,
        status: "ACTIVE",
      },
    });

    const updatedCause = await recomputeCause(id);
    await logActivity(
      session?.name ?? donorName,
      "PLEDGE",
      "Pledge",
      `${cause.code} · ₹${amountPerMonth}/mo × ${months}mo`,
      session?.userId
    );

    await invalidateCauses();
    return json(res, { pledge, cause: updatedCause }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});
