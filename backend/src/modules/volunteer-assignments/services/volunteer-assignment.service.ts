/**
 * Volunteer assignment service — auto-generates VolunteerTasks from another
 * module's record (a distribution drive, a campaign or an awareness event).
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. Field checks keep the exact legacy order (record 404s between
 * the ref and volunteer checks, duplicate skip before task creation) and
 * every log event keeps its legacy name.
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { ApiError, NotFoundError } from "@/shared/errors";
import type {
  CreateVolunteerTaskData,
  VolunteerAssignmentRepository,
  VolunteerTaskRow,
  VolunteerTaskWithVolunteer,
} from "../repositories/volunteer-assignment.repository.interface";
import type { CreateAssignmentBody, ListAssignmentsQuery } from "../schemas/volunteer-assignment.schema";

const log = logger.child("volunteer-assignments");

const REF_TYPES = ["DISTRIBUTION", "CAMPAIGN", "EVENT"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export interface AssignmentCreateResult {
  tasks: VolunteerTaskRow[];
  skipped: number;
}

export class VolunteerAssignmentService {
  constructor(private readonly volunteerAssignmentRepository: VolunteerAssignmentRepository) {}

  /** GET /api/volunteer-assignments?refType=&refId= (ADMIN) — tasks for one
   *  record, newest first, incl. volunteer.user.name. */
  async list(session: Session, query: ListAssignmentsQuery): Promise<VolunteerTaskWithVolunteer[]> {
    const refType = query.refType;
    const refId = query.refId;
    if (!REF_TYPES.includes(refType as (typeof REF_TYPES)[number]))
      throw new ApiError("refType must be DISTRIBUTION, CAMPAIGN or EVENT", 400);
    if (!refId) throw new ApiError("refId is required", 400);

    return this.volunteerAssignmentRepository.listTasksByRef(refType, refId);
  }

  /** POST /api/volunteer-assignments (ADMIN) — ONE task per volunteer, createdFrom
   *  "AUTO". Duplicates skipped: volunteer+refType+refId already has a task with
   *  status != CANCELLED. Unknown volunteers → 404. Every task description
   *  mentions the source refId. */
  async create(session: Session, body: CreateAssignmentBody): Promise<AssignmentCreateResult> {
    const refType = String(body?.refType ?? "").trim().toUpperCase();
    if (!REF_TYPES.includes(refType as (typeof REF_TYPES)[number]))
      throw new ApiError("refType must be DISTRIBUTION, CAMPAIGN or EVENT", 400);
    const refId = String(body?.refId ?? "").trim();
    if (!refId) throw new ApiError("refId is required", 400);

    const volunteerIds = Array.from(
      new Set(
        (Array.isArray(body?.volunteerIds) ? body.volunteerIds : [])
          .map((v) => String(v).trim())
          .filter(Boolean)
      )
    );
    if (volunteerIds.length === 0)
      throw new ApiError("volunteerIds must contain at least one volunteer", 400);

    // Validate the linked record where a model exists (EVENT is free-form today).
    let recordTitle: string | null = null;
    if (refType === "DISTRIBUTION") {
      const record = await this.volunteerAssignmentRepository.findDistributionById(refId);
      if (!record) {
        log.warn("volunteer_assignment_ref_not_found", { refType, refId, actor: session.userId });
        throw new NotFoundError("Distribution not found");
      }
    } else if (refType === "CAMPAIGN") {
      const record = await this.volunteerAssignmentRepository.findCampaignById(refId);
      if (!record) {
        log.warn("volunteer_assignment_ref_not_found", { refType, refId, actor: session.userId });
        throw new NotFoundError("Campaign not found");
      }
      recordTitle = record.title;
    }

    // Validate volunteers exist.
    const volunteers = await this.volunteerAssignmentRepository.findVolunteersByIds(volunteerIds);
    const foundIds = new Set(volunteers.map((v) => v.id));
    const missing = volunteerIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      log.warn("volunteer_assignment_volunteers_not_found", {
        refType,
        refId,
        missing,
        actor: session.userId,
      });
      throw new NotFoundError(`Volunteer(s) not found: ${missing.join(", ")}`);
    }

    // Skip duplicates: same volunteer + refType + refId, task not CANCELLED.
    const existingVolunteerIds = await this.volunteerAssignmentRepository.findExistingTaskVolunteerIds(
      refType,
      refId,
      volunteerIds
    );
    const alreadyAssigned = new Set(existingVolunteerIds);

    const scheduledDate = body?.scheduledDate
      ? new Date(String(body.scheduledDate))
      : new Date(Date.now() + 3 * 86_400_000);
    if (Number.isNaN(scheduledDate.getTime()))
      throw new ApiError("scheduledDate is not a valid date", 400);

    const priority = String(body?.priority ?? "MEDIUM").trim().toUpperCase();
    if (!PRIORITIES.includes(priority))
      throw new ApiError("priority must be LOW, MEDIUM or HIGH", 400);

    const refLabel = titleCase(refType); // Distribution / Campaign / Event
    const title = String(body?.title ?? "").trim() || `${refLabel} support`;
    const description = `Auto-assigned from ${refLabel} ${refId}${
      recordTitle ? ` — ${recordTitle}` : ""
    }. Generated for United Angel Reach field coordination.`;
    const location = body?.location ? String(body.location).trim() : null;
    const notes = body?.notes ? String(body.notes).trim() : null;
    // DISTRIBUTION refs run distribution drives; campaign/event refs are events.
    const type = refType === "DISTRIBUTION" ? "DISTRIBUTION" : "EVENT";

    const created: VolunteerTaskRow[] = [];
    const skippedIds: string[] = [];
    for (const volunteer of volunteers) {
      if (alreadyAssigned.has(volunteer.id)) {
        skippedIds.push(volunteer.id);
        continue;
      }
      const data: CreateVolunteerTaskData = {
        volunteerId: volunteer.id,
        title,
        description,
        type,
        priority,
        location,
        scheduledDate,
        refType,
        refId,
        createdFrom: "AUTO",
        ...(notes ? { notes } : {}),
      };
      created.push(await this.volunteerAssignmentRepository.createTask(data));
    }

    log.info("volunteer_tasks_assigned", {
      refType,
      refId,
      taskIds: created.map((t) => t.id),
      skippedCount: skippedIds.length,
      actor: session.userId,
    });
    if (skippedIds.length > 0)
      log.warn("volunteer_assignment_duplicates_skipped", {
        refType,
        refId,
        volunteerIds: skippedIds,
        actor: session.userId,
      });

    await logActivity(
      session.name,
      "VOLUNTEERS_ASSIGNED",
      "VOLUNTEER_TASK",
      `${created.length} task(s) for ${refType} ${refId}${
        created.length < volunteers.length
          ? ` · ${volunteers.length - created.length} duplicate(s) skipped`
          : ""
      }`,
      session.userId
    );

    return { tasks: created, skipped: volunteers.length - created.length };
  }
}
