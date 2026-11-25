/**
 * Profile routes — /api/profile, /api/profile/analytics, /api/profile/password
 * Converted 1:1 from src/app/api/profile/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  verifyPassword,
  hashPassword,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const router = Router();

const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

function safeUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  isActive: boolean;
  phone: string | null;
  city: string | null;
  pan: string | null;
  about: string | null;
  avatar: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const { id, email, name, role, status, isActive, phone, city, pan, about, avatar, createdAt, updatedAt } = u;
  return { id, email, name, role, status, isActive, phone, city, pan, about, avatar, createdAt, updatedAt };
}

// GET /api/profile — the signed-in user's full record + role-aware extras
// (donor CRM stats / volunteer profile / beneficiary case). Used by the
// universal profile page for EVERY role.
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new ApiError("Account not found", 404);

    const extras: Record<string, unknown> = {};

    if (session.role === "DONOR") {
      const donationScope = {
        OR: [{ donorId: session.userId }, { donorEmail: session.email }],
      };
      const [donor, agg, completed, campaignIds] = await Promise.all([
        db.donor.findFirst({
          where: { OR: [{ userId: session.userId }, { email: session.email }] },
        }),
        db.donation.aggregate({
          where: donationScope,
          _sum: { amount: true },
          _count: { _all: true },
          _min: { createdAt: true },
          _max: { createdAt: true },
        }),
        db.donation.aggregate({
          where: { ...donationScope, paymentStatus: "COMPLETED" },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        db.donation.findMany({
          where: { ...donationScope, campaignId: { not: null } },
          select: { campaignId: true },
          distinct: ["campaignId"],
        }),
      ]);
      extras.donor = donor;
      extras.stats = {
        lifetimeValue: completed._sum.amount ?? 0,
        donationCount: agg._count._all,
        completedCount: completed._count._all,
        receiptsCount: completed._count._all, // every completed gift carries an 80G receipt number
        campaignsSupported: campaignIds.length,
        firstDonationAt: agg._min.createdAt,
        lastDonationAt: agg._max.createdAt,
      };
    }

    if (session.role === "VOLUNTEER") {
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      if (volunteer) {
        const [tasksAssigned, tasksCompleted, attendanceDays, hours] = await Promise.all([
          db.volunteerTask.count({
            where: { volunteerId: volunteer.id, status: { not: "CANCELLED" } },
          }),
          db.volunteerTask.count({
            where: { volunteerId: volunteer.id, status: "COMPLETED" },
          }),
          db.volunteerAttendance.count({ where: { volunteerId: volunteer.id } }),
          db.volunteerAttendance.aggregate({
            where: { volunteerId: volunteer.id },
            _sum: { hours: true },
          }),
        ]);
        extras.volunteer = volunteer;
        extras.stats = {
          tasksAssigned,
          tasksCompleted,
          attendanceDays,
          hoursLogged: hours._sum.hours ?? 0,
        };
      } else {
        extras.volunteer = null;
        extras.stats = {
          tasksAssigned: 0,
          tasksCompleted: 0,
          attendanceDays: 0,
          hoursLogged: 0,
        };
      }
    }

    if (session.role === "BENEFICIARY") {
      const beneficiary = await db.beneficiary.findUnique({
        where: { userId: session.userId },
      });
      const requests = await db.beneficiaryRequest.findMany({
        where: beneficiary
          ? { OR: [{ userId: session.userId }, { beneficiaryId: beneficiary.id }] }
          : { userId: session.userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const requestsByStatus: Record<string, number> = {};
      for (const r of requests) {
        requestsByStatus[r.status] = (requestsByStatus[r.status] ?? 0) + 1;
      }
      extras.beneficiary = beneficiary;
      extras.stats = {
        totalRequests: requests.length,
        requestsByStatus,
        caseStatus: beneficiary?.caseStatus ?? null,
      };
      extras.recentRequests = requests;
    }

    if (session.role === "ADMIN") {
      const actionsCount = await db.activityLog.count({ where: { userId: session.userId } });
      extras.stats = { actionsCount };
    }

    return json(res, { user: safeUser(user), extras });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/profile — self-service edits (name/phone/city/about/avatar only).
// Role and email are deliberately NOT editable here — that is an admin action
// in Users & Roles.
router.patch("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = req.body ?? {};

    const data: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("Name cannot be empty", 400);
      data.name = name;
    }
    if (body?.phone !== undefined) {
      const phone = body.phone ? String(body.phone).trim() : null;
      if (phone && !PHONE_RE.test(phone.replace(/[\s-]/g, "")))
        throw new ApiError("Enter a valid 10-digit Indian mobile number", 400);
      data.phone = phone;
    }
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.about !== undefined) data.about = body.about ? String(body.about) : null;
    if (body?.avatar !== undefined) data.avatar = body.avatar ? String(body.avatar) : null;

    if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);

    const updated = await db.user.update({
      where: { id: session.userId },
      data,
    });

    await logActivity(
      updated.name,
      "PROFILE_UPDATE",
      "USER",
      `${updated.email} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    return json(res, { user: safeUser(updated) });
  } catch (e) {
    return handleError(e, res);
  }
});

/**
 * GET /api/profile/analytics — role-aware aggregate object for the universal
 * "My analytics" page.
 *
 *  ADMIN       → { actionsCount, entityBreakdown, recentActions }
 *  DONOR       → { totalDonated, donationCount, receiptsCount, campaignsSupported,
 *                  firstDonationAt, lastDonationAt, monthlyTrend, categoriesSplit,
 *                  recentDonations }
 *  VOLUNTEER   → { tasksAssigned, tasksCompleted, completionRate, hoursLogged,
 *                  attendanceDays, upcomingTasks, tasksByType, recentTasks }
 *  BENEFICIARY → { totalRequests, requestsByStatus, caseStatus, recentRequests }
 *
 * Always returns { role, generatedAt, ...aggregates } — every role gets a
 * shape the shared UserAnalyticsView can render with graceful empty states.
 */
router.get("/analytics", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const out: Record<string, unknown> = { role: session.role, generatedAt: new Date().toISOString() };

    /* ------------------------------- ADMIN ------------------------------- */
    if (session.role === "ADMIN") {
      const [actionsCount, breakdown, recent] = await Promise.all([
        db.activityLog.count({ where: { userId: session.userId } }),
        db.activityLog.groupBy({
          by: ["entityType"],
          where: { userId: session.userId },
          _count: { _all: true },
        }),
        db.activityLog.findMany({
          where: { userId: session.userId },
          orderBy: { createdAt: "desc" },
          take: 12,
        }),
      ]);
      out.actionsCount = actionsCount;
      out.entityBreakdown = breakdown
        .map((b) => ({ entityType: b.entityType, count: b._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
      out.recentActions = recent.map((r) => ({
        action: r.action,
        entityType: r.entityType,
        details: r.details,
        createdAt: r.createdAt,
      }));
      return json(res, out);
    }

    /* -------------------------------- DONOR ------------------------------ */
    if (session.role === "DONOR") {
      const scope = { OR: [{ donorId: session.userId }, { donorEmail: session.email }] };
      const since = new Date();
      since.setMonth(since.getMonth() - 5);
      since.setDate(1);
      since.setHours(0, 0, 0, 0);

      const [all, completedAgg, completedDonations, campaignIds, recent] = await Promise.all([
        db.donation.aggregate({ where: scope, _count: { _all: true } }),
        db.donation.aggregate({
          where: { ...scope, paymentStatus: "COMPLETED" },
          _sum: { amount: true },
          _count: { _all: true },
          _min: { createdAt: true },
          _max: { createdAt: true },
        }),
        db.donation.findMany({
          where: { ...scope, paymentStatus: "COMPLETED", createdAt: { gte: since } },
          select: { createdAt: true, amount: true },
        }),
        db.donation.findMany({
          where: { ...scope, campaignId: { not: null } },
          select: { campaignId: true },
          distinct: ["campaignId"],
        }),
        db.donation.findMany({
          where: scope,
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            receiptNumber: true,
            amount: true,
            category: true,
            type: true,
            paymentStatus: true,
            createdAt: true,
            campaign: { select: { title: true } },
          },
        }),
      ]);

      const categories = await db.donation.groupBy({
        by: ["category"],
        where: { ...scope, paymentStatus: "COMPLETED" },
        _sum: { amount: true },
        _count: { _all: true },
      });

      // Last-6-month trend (including the current month), zero-filled.
      const monthly: Array<{ month: string; amount: number }> = [];
      const buckets = new Map<string, number>();
      for (const d of completedDonations) {
        const dt = new Date(d.createdAt);
        const key = `${dt.getFullYear()}-${dt.getMonth()}`;
        buckets.set(key, (buckets.get(key) ?? 0) + (Number(d.amount) || 0));
      }
      for (let i = 5; i >= 0; i--) {
        const dt = new Date();
        dt.setDate(1);
        dt.setMonth(dt.getMonth() - i);
        monthly.push({
          month: dt.toLocaleString("en-IN", { month: "short" }),
          amount: buckets.get(`${dt.getFullYear()}-${dt.getMonth()}`) ?? 0,
        });
      }

      out.totalDonated = completedAgg._sum.amount ?? 0;
      out.donationCount = all._count._all;
      out.receiptsCount = completedAgg._count._all;
      out.campaignsSupported = campaignIds.length;
      out.firstDonationAt = completedAgg._min.createdAt;
      out.lastDonationAt = completedAgg._max.createdAt;
      out.monthlyTrend = monthly;
      out.categoriesSplit = categories
        .map((c) => ({ category: c.category, amount: c._sum.amount ?? 0, count: c._count._all }))
        .sort((a, b) => b.amount - a.amount);
      out.recentDonations = recent.map((d) => ({
        ...d,
        campaignTitle: d.campaign?.title ?? null,
        campaign: undefined,
      }));
      return json(res, out);
    }

    /* ------------------------------ VOLUNTEER ---------------------------- */
    if (session.role === "VOLUNTEER") {
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      if (!volunteer) {
        Object.assign(out, {
          tasksAssigned: 0,
          tasksCompleted: 0,
          completionRate: 0,
          hoursLogged: 0,
          attendanceDays: 0,
          upcomingTasks: [],
          tasksByType: [],
          recentTasks: [],
        });
        return json(res, out);
      }

      const now = new Date();
      const [tasksAssigned, tasksCompleted, attendanceDays, hours, byType, upcoming, recent] =
        await Promise.all([
          db.volunteerTask.count({
            where: { volunteerId: volunteer.id, status: { not: "CANCELLED" } },
          }),
          db.volunteerTask.count({
            where: { volunteerId: volunteer.id, status: "COMPLETED" },
          }),
          db.volunteerAttendance.count({ where: { volunteerId: volunteer.id } }),
          db.volunteerAttendance.aggregate({
            where: { volunteerId: volunteer.id },
            _sum: { hours: true },
          }),
          db.volunteerTask.groupBy({
            by: ["type"],
            where: { volunteerId: volunteer.id },
            _count: { _all: true },
          }),
          db.volunteerTask.findMany({
            where: {
              volunteerId: volunteer.id,
              scheduledDate: { gte: now },
              status: { in: ["ASSIGNED", "IN_PROGRESS"] },
            },
            orderBy: { scheduledDate: "asc" },
            take: 5,
          }),
          db.volunteerTask.findMany({
            where: { volunteerId: volunteer.id },
            orderBy: { scheduledDate: "desc" },
            take: 6,
          }),
        ]);

      out.tasksAssigned = tasksAssigned;
      out.tasksCompleted = tasksCompleted;
      out.completionRate =
        tasksAssigned > 0 ? Math.round((tasksCompleted / tasksAssigned) * 100) : 0;
      out.hoursLogged = hours._sum.hours ?? 0;
      out.attendanceDays = attendanceDays;
      out.upcomingTasks = upcoming.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        priority: t.priority,
        location: t.location,
        scheduledDate: t.scheduledDate,
      }));
      out.tasksByType = byType
        .map((t) => ({ type: t.type, count: t._count._all }))
        .sort((a, b) => b.count - a.count);
      out.recentTasks = recent.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        status: t.status,
        scheduledDate: t.scheduledDate,
      }));
      return json(res, out);
    }

    /* ----------------------------- BENEFICIARY --------------------------- */
    // BENEFICIARY (and any other signed-in role) — help-request analytics.
    const beneficiary = await db.beneficiary.findUnique({
      where: { userId: session.userId },
    });
    const requestScope = beneficiary
      ? { OR: [{ userId: session.userId }, { beneficiaryId: beneficiary.id }] }
      : { userId: session.userId };

    const [totalRequests, byStatus, recent] = await Promise.all([
      db.beneficiaryRequest.count({ where: requestScope }),
      db.beneficiaryRequest.groupBy({
        by: ["status"],
        where: requestScope,
        _count: { _all: true },
      }),
      db.beneficiaryRequest.findMany({
        where: requestScope,
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

    out.totalRequests = totalRequests;
    out.requestsByStatus = byStatus
      .map((s) => ({ status: s.status, count: s._count._all }))
      .sort((a, b) => b.count - a.count);
    out.caseStatus = beneficiary?.caseStatus ?? null;
    out.recentRequests = recent.map((r) => ({
      id: r.id,
      category: r.category,
      urgency: r.urgency,
      status: r.status,
      details: r.details,
      createdAt: r.createdAt,
    }));

    return json(res, out);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/profile/password — self-service password change.
// Body: { current, next } — verifies the current password, enforces min length.
router.post("/password", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = req.body ?? {};

    const current = String(body?.current ?? "");
    const next = String(body?.next ?? "");

    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new ApiError("Account not found", 404);

    if (!current || !verifyPassword(current, user.password))
      throw new ApiError("Current password is incorrect", 400);
    if (!next || next.length < 6)
      throw new ApiError("New password must be at least 6 characters", 400);
    if (next === current)
      throw new ApiError("New password must be different from the current one", 400);

    await db.user.update({
      where: { id: session.userId },
      data: { password: hashPassword(next) },
    });

    await logActivity(
      session.name,
      "PASSWORD_CHANGE",
      "USER",
      `${session.email} changed their password`,
      session.userId
    );

    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
