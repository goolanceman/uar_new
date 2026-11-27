/**
 * Volunteer service — roster listings, the analytics roll-up, self-profile
 * and the admin/volunteer profile updates (with the shared user-status
 * mirror). Depends on the repository contract, throws application errors,
 * never touches HTTP.
 *
 * The legacy PATCH handler validated body fields mid-handler after the
 * volunteer lookup (404-before-400 ordering), so those checks and their
 * exact messages live here instead of in a route-level Zod schema.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { setUserStatus } from "@/lib/user-status";
import type {
  VolunteerDetail,
  VolunteerListFilter,
  VolunteerRepository,
  VolunteerRow,
  VolunteerUpdateData,
  VolunteerWithTasks,
  VolunteerWithUser,
} from "../repositories/volunteer.repository.interface";
import type { ListVolunteersQuery, UpdateVolunteerBody } from "../schemas/volunteer.schema";

const log = logger.child("volunteers");

const TASK_TYPES = ["DISTRIBUTION", "KIT_SCAN", "INVENTORY", "EVENT", "RESCUE", "AMBULANCE"];
const TASK_STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

export interface VolunteerAnalytics {
  kpis: {
    totalVolunteers: number;
    activeVolunteers: number;
    pendingApplications: number;
    tasksAssigned: number;
    tasksCompleted: number;
    completionRate: number;
    hoursThisMonth: number;
  };
  tasksByType: Array<{ type: string; count: number }>;
  taskStatus: Array<{ status: string; count: number }>;
  leaderboard: Array<{
    volunteerId: string;
    name: string;
    assigned: number;
    completed: number;
  }>;
  monthlyHours: Array<{ key: string; label: string; hours: number }>;
}

export interface PagedVolunteers {
  items: VolunteerWithUser[];
  total: number;
  page: number;
  pages: number;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export class VolunteerService {
  constructor(private readonly volunteerRepository: VolunteerRepository) {}

  /**
   * GET /api/volunteers (ADMIN) — roster array (legacy shape, status filter).
   * Optional pagination (gap A-8, backward-compatible): with no ?page/limit
   * the legacy unpaginated array shape is returned exactly as before.
   */
  async list(
    query: ListVolunteersQuery
  ): Promise<VolunteerWithUser[] | PagedVolunteers | VolunteerAnalytics> {
    if (query.analytics) {
      return this.analytics();
    }

    const filter: VolunteerListFilter = { status: query.status };

    if (query.page || query.limit) {
      const page = Math.max(1, Math.trunc(Number(query.page) || 1));
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(query.limit) || 20)));
      const { rows, total } = await this.volunteerRepository.listPaged(
        filter,
        (page - 1) * limit,
        limit
      );
      return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
    }

    return this.volunteerRepository.list(filter);
  }

  /**
   * GET /api/volunteers?analytics=1 (ADMIN) — module analytics roll-up for
   * the Analytics tab: KPIs, tasks by type, status distribution, leaderboard
   * and a 6-month hours trend.
   */
  async analytics(): Promise<VolunteerAnalytics> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [volunteers, pendingApps, tasks, attendance] = await Promise.all([
      this.volunteerRepository.listRosterSummaries(),
      this.volunteerRepository.countPendingApplications(),
      this.volunteerRepository.listTaskSummaries(),
      this.volunteerRepository.listAttendanceSince(sixMonthsAgo),
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

  /**
   * GET /api/volunteers/me — { volunteer: profile incl tasks | null,
   * application: latest VolunteerApplication | null }.
   */
  async me(userId: string): Promise<{
    volunteer: VolunteerWithTasks | null;
    application: Awaited<ReturnType<VolunteerRepository["findLatestApplication"]>>;
  }> {
    const volunteer = await this.volunteerRepository.findByUserIdWithTasks(userId);
    const application = await this.volunteerRepository.findLatestApplication(userId);
    return { volunteer: volunteer ?? null, application: application ?? null };
  }

  /**
   * PATCH /api/volunteers/:id — admin updates the volunteer profile; a
   * volunteer may update the self-service roster fields of their own record.
   */
  async update(id: string, body: UpdateVolunteerBody, actor: Session): Promise<VolunteerRow> {
    const body_ = { ...body };
    const existing = await this.volunteerRepository.findById(id);
    if (!existing) {
      log.warn("volunteer_update_not_found", { volunteerId: id, actor: actor.userId });
      throw new ApiError("Volunteer not found", 404);
    }
    if (actor.role === "VOLUNTEER") {
      if (existing.userId !== actor.userId) {
        log.warn("volunteer_update_forbidden", {
          volunteerId: id,
          actor: actor.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
      delete body_.status;
      delete body_.assignedArea;
    }

    const data: VolunteerUpdateData = {};
    if (body_?.skills !== undefined)
      data.skills = body_.skills ? String(body_.skills) : null;
    if (body_?.availability !== undefined)
      data.availability = body_.availability ? String(body_.availability) : null;
    if (body_?.assignedArea !== undefined)
      data.assignedArea = body_.assignedArea ? String(body_.assignedArea).trim() : null;
    if (body_?.emergencyContact !== undefined)
      data.emergencyContact = body_.emergencyContact ? String(body_.emergencyContact).trim() : null;
    if (body_?.idProof !== undefined)
      data.idProof = body_.idProof ? String(body_.idProof).trim() : null;
    if (body_?.status !== undefined) {
      const status = String(body_.status);
      if (!["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED"].includes(status))
        throw new ApiError("Invalid volunteer status", 400);
      data.status = status;
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const volunteer = await this.volunteerRepository.update(id, data);
    log.info("volunteer_updated", {
      volunteerId: id,
      fields: Object.keys(data),
      ...(data.status !== undefined ? { newStatus: data.status } : {}),
      actor: actor.userId,
    });

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
          actorName: actor.name,
          actorId: actor.userId,
          reason: `volunteer status → ${data.status}`,
          isActive: mirror.isActive,
        });
      }
    }

    await logActivity(
      actor.name,
      "VOLUNTEER_UPDATE",
      "VOLUNTEER",
      `${volunteer.id} → ${Object.keys(data).join(", ")}`,
      actor.userId
    );

    return volunteer;
  }

  /** GET /api/volunteers/:id — profile with tasks + attendance summary. */
  async get(id: string): Promise<VolunteerDetail & { stats: VolunteerDetailStats }> {
    const volunteer = await this.volunteerRepository.findDetailById(id);
    if (!volunteer) throw new ApiError("Volunteer not found", 404);

    const hours = volunteer.attendances.reduce((s, a) => s + (a.hours ?? 0), 0);
    return {
      ...volunteer,
      stats: {
        tasksAssigned: volunteer.tasks.length,
        tasksCompleted: volunteer.tasks.filter((t) => t.status === "COMPLETED").length,
        daysPresent: volunteer.attendances.length,
        totalHours: Math.round(hours * 10) / 10,
      },
    };
  }
}

export interface VolunteerDetailStats {
  tasksAssigned: number;
  tasksCompleted: number;
  daysPresent: number;
  totalHours: number;
}
