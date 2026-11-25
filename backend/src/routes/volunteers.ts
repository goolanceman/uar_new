/**
 * Volunteers routes — /api/volunteers, /api/volunteers/me, /api/volunteers/:id
 * Converted 1:1 from src/app/api/volunteers/* (Next.js route handlers) to Express.
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
import { setUserStatus } from "@/lib/user-status";

export const router = Router();

const TASK_TYPES = ["DISTRIBUTION", "KIT_SCAN", "INVENTORY", "EVENT", "RESCUE", "AMBULANCE"];
const TASK_STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

// GET /api/volunteers            (ADMIN) — roster array (legacy shape, status filter)
// GET /api/volunteers?analytics=1 (ADMIN) — module analytics roll-up for the
//   Analytics tab: KPIs, tasks by type, status distribution, leaderboard and
//   a 6-month hours trend.
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const status = sp.get("status") || undefined;

    if (sp.get("analytics") === "1") {
      return json(res, await buildAnalytics());
    }

    const where: Prisma.VolunteerWhereInput = {};
    if (status) where.status = status;

    // Optional pagination (gap A-8, backward-compatible): with no ?page/limit
    // the legacy unpaginated array shape is returned exactly as before.
    const pageRaw = sp.get("page");
    const limitRaw = sp.get("limit");
    if (pageRaw || limitRaw) {
      const page = Math.max(1, Math.trunc(Number(pageRaw) || 1));
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(limitRaw) || 20)));
      const [items, total] = await Promise.all([
        db.volunteer.findMany({
          where,
          orderBy: { joinedAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            user: { select: { name: true, email: true, phone: true, city: true } },
          },
        }),
        db.volunteer.count({ where }),
      ]);
      return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
    }

    const volunteers = await db.volunteer.findMany({
      where,
      orderBy: { joinedAt: "desc" },
      include: {
        user: { select: { name: true, email: true, phone: true, city: true } },
      },
    });
    return json(res, volunteers);
  } catch (e) {
    return handleError(e, res);
  }
});

/* ------------------------------ analytics roll-up ------------------------------ */

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function buildAnalytics() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [volunteers, pendingApps, tasks, attendance] = await Promise.all([
    db.volunteer.findMany({
      select: {
        id: true,
        status: true,
        user: { select: { name: true } },
      },
    }),
    db.volunteerApplication.count({ where: { status: "PENDING" } }),
    db.volunteerTask.findMany({
      select: { type: true, status: true, volunteerId: true },
    }),
    db.volunteerAttendance.findMany({
      where: { date: { gte: sixMonthsAgo } },
      select: { date: true, hours: true },
    }),
  ]);

  const liveTasks = tasks.filter((t) => t.status !== "CANCELLED");
  const tasksCompleted = tasks.filter((t) => t.status === "COMPLETED").length;

  const hoursThisMonth = attendance
    .filter((a) => a.date >= monthStart)
    .reduce((s, a) => s + (a.hours ?? 0), 0);

  const tasksByType = TASK_TYPES.map((type) => ({
    type,
    count: tasks.filter((t) => t.type === type).length,
  }));

  const taskStatus = TASK_STATUSES.map((status) => ({
    status,
    count: tasks.filter((t) => t.status === status).length,
  }));

  // Top 5 volunteers by completed tasks (assigned = non-cancelled).
  const leaderboard = volunteers
    .map((v) => {
      const mine = tasks.filter((t) => t.volunteerId === v.id);
      return {
        volunteerId: v.id,
        name: v.user?.name ?? "Volunteer",
        assigned: mine.filter((t) => t.status !== "CANCELLED").length,
        completed: mine.filter((t) => t.status === "COMPLETED").length,
      };
    })
    .sort((a, b) => b.completed - a.completed || b.assigned - a.assigned)
    .slice(0, 5);

  // Monthly hours trend — last 6 calendar months, zero-filled.
  const monthlyHours: Array<{ key: string; label: string; hours: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthlyHours.push({
      key: monthKey(d),
      label: d.toLocaleDateString("en-IN", { month: "short" }),
      hours: 0,
    });
  }
  for (const a of attendance) {
    const bucket = monthlyHours.find((m) => m.key === monthKey(a.date));
    if (bucket && a.hours)
      bucket.hours = Math.round((bucket.hours + a.hours) * 10) / 10;
  }

  return {
    kpis: {
      totalVolunteers: volunteers.length,
      activeVolunteers: volunteers.filter((v) => v.status === "ACTIVE").length,
      pendingApplications: pendingApps,
      tasksAssigned: liveTasks.length,
      tasksCompleted,
      completionRate:
        liveTasks.length > 0
          ? Math.round((tasksCompleted / liveTasks.length) * 100)
          : 0,
      hoursThisMonth: Math.round(hoursThisMonth * 10) / 10,
    },
    tasksByType,
    taskStatus,
    leaderboard,
    monthlyHours,
  };
}

// GET /api/volunteers/me (auth)
// → { volunteer: profile incl tasks | null, application: latest VolunteerApplication | null }
router.get("/me", async (req, res) => {
  try {
    const session = await requireAuth(req);

    const volunteer = await db.volunteer.findUnique({
      where: { userId: session.userId },
      include: { tasks: { orderBy: { scheduledDate: "desc" } } },
    });

    const application = await db.volunteerApplication.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
    });

    return json(res, { volunteer: volunteer ?? null, application: application ?? null });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/volunteers/:id — admin updates the volunteer profile
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.volunteer.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Volunteer not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.skills !== undefined)
      data.skills = body.skills ? String(body.skills) : null;
    if (body?.availability !== undefined)
      data.availability = body.availability ? String(body.availability) : null;
    if (body?.assignedArea !== undefined)
      data.assignedArea = body.assignedArea ? String(body.assignedArea).trim() : null;
    if (body?.emergencyContact !== undefined)
      data.emergencyContact = body.emergencyContact ? String(body.emergencyContact).trim() : null;
    if (body?.idProof !== undefined)
      data.idProof = body.idProof ? String(body.idProof).trim() : null;
    if (body?.status !== undefined) {
      const status = String(body.status);
      if (!["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED"].includes(status))
        throw new ApiError("Invalid volunteer status", 400);
      data.status = status;
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const volunteer = await db.volunteer.update({ where: { id }, data });

    // Mirror account-level status on the linked user row through the shared
    // User-status owner (single source of truth for sign-in gates):
    // SUSPENDED volunteer ⇒ suspended user, ACTIVE ⇒ active.
    if (typeof data.status === "string") {
      const statusMap: Record<string, { status: string; isActive: boolean }> = {
        ACTIVE: { status: "ACTIVE", isActive: true },
        INACTIVE: { status: "ACTIVE", isActive: false },
        SUSPENDED: { status: "SUSPENDED", isActive: false },
        PENDING: { status: "ACTIVE", isActive: false },
      };
      const mirror = statusMap[data.status];
      if (mirror) {
        await setUserStatus(existing.userId, mirror.status, {
          actorName: session.name,
          actorId: session.userId,
          reason: `volunteer status → ${data.status}`,
          isActive: mirror.isActive,
        });
      }
    }

    await logActivity(
      session.name,
      "VOLUNTEER_UPDATE",
      "VOLUNTEER",
      `${volunteer.id} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    return json(res, volunteer);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/volunteers/:id — profile with tasks + attendance summary
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const { id } = req.params;
    const volunteer = await db.volunteer.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, city: true, status: true } },
        tasks: { orderBy: { scheduledDate: "desc" }, take: 50 },
        attendances: { orderBy: { date: "desc" }, take: 60 },
      },
    });
    if (!volunteer) throw new ApiError("Volunteer not found", 404);

    const hours = volunteer.attendances.reduce((s, a) => s + (a.hours ?? 0), 0);
    return json(res, {
      ...volunteer,
      stats: {
        tasksAssigned: volunteer.tasks.length,
        tasksCompleted: volunteer.tasks.filter((t) => t.status === "COMPLETED").length,
        daysPresent: volunteer.attendances.length,
        totalHours: Math.round(hours * 10) / 10,
      },
    });
  } catch (e) {
    return handleError(e, res);
  }
});
