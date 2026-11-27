/**
 * Volunteer task service — task assignment rules and the status state
 * machine. Depends on the repository contract, throws application errors,
 * never touches HTTP.
 *
 * The legacy handlers validated body fields mid-handler after the auth gate
 * (with the volunteer/task lookups interleaved — 404-before-400 ordering),
 * so those checks and their exact messages live here instead of in a
 * route-level Zod schema.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { TASK_STATUSES, TASK_TRANSITIONS } from "@/modules/volunteer-tasks/services/volunteer-tasks.domain";
import { assertTransition } from "@/shared/workflow";
import type {
  CreateVolunteerTaskData,
  UpdateVolunteerTaskData,
  VolunteerTaskListFilter,
  VolunteerTaskRepository,
  VolunteerTaskRow,
  VolunteerTaskWithVolunteer,
} from "../repositories/volunteer-task.repository.interface";
import type {
  CreateVolunteerTaskBody,
  ListVolunteerTasksQuery,
  UpdateVolunteerTaskBody,
} from "../schemas/volunteer-task.schema";

const log = logger.child("volunteer-tasks");

const TASK_TYPES = ["DISTRIBUTION", "KIT_SCAN", "INVENTORY", "EVENT", "RESCUE", "AMBULANCE"];
const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const REF_TYPES = ["DISTRIBUTION", "CAMPAIGN", "EVENT", "MISSION"];

export interface PagedVolunteerTasks {
  items: VolunteerTaskWithVolunteer[];
  total: number;
  page: number;
  pages: number;
}

export class VolunteerTaskService {
  constructor(private readonly volunteerTaskRepository: VolunteerTaskRepository) {}

  /** GET /api/volunteer-tasks?mine=1 — the session volunteer's tasks, desc
   *  scheduledDate (empty array when the user has no volunteer profile). */
  async listMine(userId: string): Promise<VolunteerTaskRow[]> {
    const volunteer = await this.volunteerTaskRepository.findVolunteerByUserId(userId);
    if (!volunteer) return [];
    return this.volunteerTaskRepository.listByVolunteer(volunteer.id);
  }

  /**
   * GET /api/volunteer-tasks (ADMIN) — roster with ?status&type&volunteerId&
   * refType&refId&q filters. Optional pagination (gap A-8, backward-
   * compatible): with no ?page/limit the legacy unpaginated array shape is
   * returned exactly as before.
   */
  async list(query: ListVolunteerTasksQuery): Promise<VolunteerTaskWithVolunteer[] | PagedVolunteerTasks> {
    const filter: VolunteerTaskListFilter = {
      status: query.status,
      type: query.type,
      volunteerId: query.volunteerId,
      refType: query.refType,
      refId: query.refId,
      q: query.q,
    };

    if (query.page || query.limit) {
      const page = Math.max(1, Math.trunc(Number(query.page) || 1));
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(query.limit) || 20)));
      const { rows, total } = await this.volunteerTaskRepository.listPaged(
        filter,
        (page - 1) * limit,
        limit
      );
      return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
    }

    return this.volunteerTaskRepository.list(filter);
  }

  /**
   * POST /api/volunteer-tasks (ADMIN) — manual task creation (createdFrom
   * MANUAL). Optional refType/refId link the task to a DISTRIBUTION /
   * CAMPAIGN / EVENT / MISSION record for cross-module tracking.
   */
  async create(body: CreateVolunteerTaskBody, actor: Session): Promise<VolunteerTaskRow> {
    const title = String(body.title ?? "").trim();
    if (!title) throw new ApiError("title is required", 400);

    const volunteerId = String(body.volunteerId ?? "");
    if (!volunteerId) throw new ApiError("volunteerId is required", 400);
    const volunteer = await this.volunteerTaskRepository.findVolunteerByIdWithUser(volunteerId);
    if (!volunteer) {
      log.warn("volunteer_task_create_volunteer_not_found", {
        volunteerId,
        actor: actor.userId,
      });
      throw new ApiError("Volunteer not found", 404);
    }

    const scheduledDate = body.scheduledDate
      ? new Date(String(body.scheduledDate))
      : null;
    if (!scheduledDate || Number.isNaN(scheduledDate.getTime()))
      throw new ApiError("scheduledDate is required", 400);

    const type = String(body.type ?? "DISTRIBUTION").trim().toUpperCase();
    if (!TASK_TYPES.includes(type)) throw new ApiError("Invalid task type", 400);
    const priority = String(body.priority ?? "MEDIUM").trim().toUpperCase();
    if (!TASK_PRIORITIES.includes(priority)) throw new ApiError("Invalid priority", 400);

    let refType: string | null = null;
    let refId: string | null = null;
    if (body.refType) {
      refType = String(body.refType).trim().toUpperCase();
      if (!REF_TYPES.includes(refType)) throw new ApiError("Invalid refType", 400);
      refId = String(body.refId ?? "").trim();
      if (!refId)
        throw new ApiError("refId is required when refType is provided", 400);
    }

    const task = await this.volunteerTaskRepository.create({
      volunteerId,
      title,
      description: body.description ? String(body.description) : null,
      type,
      priority,
      location: body.location ? String(body.location).trim() : null,
      scheduledDate,
      refType,
      refId,
      createdFrom: "MANUAL",
    });

    log.info("volunteer_task_created", {
      taskId: task.id,
      volunteerId,
      type,
      priority,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "TASK_ASSIGN",
      "VolunteerTask",
      `${title} → ${volunteer.user.name}`,
      actor.userId
    );
    return task;
  }

  /**
   * PATCH /api/volunteer-tasks/:id — ADMIN: any task · VOLUNTEER: only their
   * own task. Status moves run through the shared transition table.
   */
  async update(id: string, body: UpdateVolunteerTaskBody, actor: Session): Promise<VolunteerTaskRow> {
    const task = await this.volunteerTaskRepository.findTaskById(id);
    if (!task) {
      log.warn("volunteer_task_update_not_found", { taskId: id, actor: actor.userId });
      throw new ApiError("Task not found", 404);
    }

    if (actor.role === "VOLUNTEER") {
      const volunteer = await this.volunteerTaskRepository.findVolunteerByUserId(actor.userId);
      if (!volunteer || volunteer.id !== task.volunteerId) {
        log.warn("volunteer_task_update_forbidden", {
          taskId: id,
          actor: actor.userId,
        });
        throw new ApiError("You can only update your own tasks", 403);
      }
    }

    const data: UpdateVolunteerTaskData = {};
    if (body.notes !== undefined)
      data.notes = body.notes ? String(body.notes) : null;
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!TASK_STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
      if (status !== task.status && !(TASK_TRANSITIONS[task.status] ?? []).includes(status))
        log.warn("volunteer_task_invalid_transition", {
          taskId: id,
          from: task.status,
          to: status,
          actor: actor.userId,
        });
      assertTransition(TASK_TRANSITIONS, task.status, status, "task");
      data.status = status;
      data.completedAt = status === "COMPLETED" ? new Date() : null;
    }

    const updated = await this.volunteerTaskRepository.update(id, data);
    log.info("volunteer_task_updated", {
      taskId: id,
      fields: Object.keys(data),
      ...(data.status !== undefined ? { newStatus: updated.status } : {}),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "TASK_UPDATE",
      "VolunteerTask",
      `${task.title}${body.status !== undefined ? ` → ${updated.status}` : ""}`,
      actor.userId
    );
    return updated;
  }

  /** DELETE /api/volunteer-tasks/:id (ADMIN). */
  async remove(id: string, actor: Session): Promise<{ ok: true }> {
    const task = await this.volunteerTaskRepository.findTaskById(id);
    if (!task) {
      log.warn("volunteer_task_delete_not_found", { taskId: id, actor: actor.userId });
      throw new ApiError("Task not found", 404);
    }

    await this.volunteerTaskRepository.delete(id);
    log.info("volunteer_task_deleted", {
      taskId: id,
      status: task.status,
      actor: actor.userId,
    });
    await logActivity(actor.name, "TASK_DELETE", "VolunteerTask", task.title, actor.userId);
    return { ok: true };
  }
}
