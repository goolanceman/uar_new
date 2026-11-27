/**
 * Event volunteer service — staffing for distribution events. VolunteerTask
 * rows linked to an event via refType FOOD_EVENT (the same rows the check-in
 * desk uses to scope volunteers). Roles are stored in the free-text
 * description column, but the desk enforces the VOLUNTEER_ROLES set on write.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import type { FoodBody } from "../schemas/food.schema";
import type { FoodEventRepository } from "../repositories/food-event.repository.interface";
import type { FoodRegistrationRepository } from "../repositories/food-registration.repository.interface";

const log = logger.child("food");

// Roles are stored in VolunteerTask.description (free-text column, but the
// distribution desk enforces this set on write).
const VOLUNTEER_ROLES = ["PACKING", "QUEUE", "SERVING", "DELIVERY", "COORDINATION"];

export class EventVolunteerService {
  constructor(
    private readonly registrationRepository: FoodRegistrationRepository,
    private readonly eventRepository: FoodEventRepository
  ) {}

  /**
   * GET /api/food/events/:id/volunteers?available=1 — ADMIN assign dropdown:
   * ACTIVE volunteers not yet assigned to this event.
   */
  async listAvailable(eventId: string): Promise<unknown> {
    const assigned = await this.registrationRepository.listAssignedVolunteerIds(eventId);
    const rows = await this.registrationRepository.listAvailableVolunteers(assigned.map((a) => a.volunteerId));
    return rows.map((v) => ({ id: v.id, code: v.code, name: v.user.name, phone: v.user.phone }));
  }

  /** GET /api/food/events/:id/volunteers — task rows with assignee summaries. */
  async listForEvent(eventId: string): Promise<unknown> {
    const event = await this.eventRepository.findEventById(eventId);
    if (!event) throw new ApiError("Food event not found", 404);

    return this.registrationRepository.listEventVolunteerTasks(eventId);
  }

  /**
   * POST /api/food/events/:id/volunteers (ADMIN) — { volunteerId, role, notes? }
   * Creates a MANUAL VolunteerTask that links the volunteer to this event.
   */
  async assign(eventId: string, body: FoodBody, session: Session): Promise<unknown> {
    const event = await this.eventRepository.findEventById(eventId);
    if (!event) {
      log.warn("food_event_not_found", { eventId, actor: session.userId });
      throw new ApiError("Food event not found", 404);
    }

    const volunteerId = String(body?.volunteerId ?? "");
    const volunteer = await this.registrationRepository.findVolunteerWithUser(volunteerId);
    if (!volunteer) {
      log.warn("food_volunteer_not_found", { volunteerId, eventId, actor: session.userId });
      throw new ApiError("Volunteer not found", 404);
    }
    if (volunteer.status !== "ACTIVE") {
      log.warn("food_volunteer_not_active", { volunteerId, eventId, status: volunteer.status, actor: session.userId });
      throw new ApiError("Only ACTIVE volunteers can be assigned to an event", 400);
    }

    const role = String(body?.role ?? "").trim().toUpperCase();
    if (!VOLUNTEER_ROLES.includes(role))
      throw new ApiError(`Role must be one of: ${VOLUNTEER_ROLES.join(", ")}`, 400);

    const dupe = await this.registrationRepository.findActiveAssignment(volunteerId, eventId);
    if (dupe) {
      log.warn("food_volunteer_already_assigned", {
        volunteerId,
        eventId,
        taskId: dupe.id,
        actor: session.userId,
      });
      throw new ApiError(`${volunteer.user.name} is already assigned to this event`, 409);
    }

    const task = await this.registrationRepository.createVolunteerTask({
      volunteerId,
      title: `Food event: ${event.title}`,
      description: role,
      type: "DISTRIBUTION",
      location: event.venue,
      scheduledDate: event.eventDate,
      refType: "FOOD_EVENT",
      refId: eventId,
      status: "ASSIGNED",
      createdFrom: "MANUAL",
      notes: body?.notes ? String(body.notes).trim() : null,
    });

    log.info("food_volunteer_assigned", {
      taskId: task.id,
      eventId,
      eventCode: event.code,
      volunteerId,
      role,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "FOOD_VOLUNTEER_ASSIGN",
      "VolunteerTask",
      `${event.code}: ${volunteer.user.name} → ${role}`,
      session.userId
    );
    return task;
  }

  /**
   * DELETE /api/food/events/:id/volunteers?taskId= — soft-cancel the
   * assignment, only when the task actually belongs to this event. The
   * { ok, id, status } response is returned even when already cancelled.
   */
  async unassign(eventId: string, taskId: string, session: Session): Promise<unknown> {
    const task = await this.registrationRepository.findTaskWithVolunteer(taskId);
    if (!task || task.refType !== "FOOD_EVENT" || task.refId !== eventId) {
      log.warn("food_volunteer_assignment_not_found", { taskId, eventId, actor: session.userId });
      throw new ApiError("Assignment not found for this event", 404);
    }

    if (task.status !== "CANCELLED") {
      await this.registrationRepository.cancelTask(taskId);
      log.info("food_volunteer_unassigned", {
        taskId,
        eventId,
        volunteerCode: task.volunteer.code,
        actor: session.userId,
      });
      await logActivity(
        session.name,
        "FOOD_VOLUNTEER_REMOVE",
        "VolunteerTask",
        `${task.title}: ${task.volunteer.user.name} removed`,
        session.userId
      );
    }
    return { ok: true, id: taskId, status: "CANCELLED" };
  }
}
