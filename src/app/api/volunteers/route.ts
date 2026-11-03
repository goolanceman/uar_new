import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

const TASK_TYPES = ["DISTRIBUTION", "KIT_SCAN", "INVENTORY", "EVENT", "RESCUE", "AMBULANCE"];
const TASK_STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

// GET /api/volunteers            (ADMIN) — roster array (legacy shape, status filter)
// GET /api/volunteers?analytics=1 (ADMIN) — module analytics roll-up for the
//   Analytics tab: KPIs, tasks by type, status distribution, leaderboard and
//   a 6-month hours trend.
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status") || undefined;

    if (sp.get("analytics") === "1") {
      return json(await buildAnalytics());
    }

    const where: Prisma.VolunteerWhereInput = {};
    if (status) where.status = status;

    const volunteers = await db.volunteer.findMany({
      where,
      orderBy: { joinedAt: "desc" },
      include: {
        user: { select: { name: true, email: true, phone: true, city: true } },
      },
    });
    return json(volunteers);
  } catch (e) {
    return handleError(e);
  }
}

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
