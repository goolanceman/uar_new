import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

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
export async function GET(_req: NextRequest) {
  try {
    const session = await requireAuth();
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
      return json(out);
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
      return json(out);
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
        return json(out);
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
      return json(out);
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

    return json(out);
  } catch (e) {
    return handleError(e);
  }
}
