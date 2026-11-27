/**
 * Volunteer attendance service — the day-register rules: volunteers only ever
 * see their own register, an ACTIVE volunteer self-checks-in idempotently once
 * per day, admins record/edit days (hours derived from the check-in/out pair
 * when not typed). Depends on the repository contract, never touches HTTP.
 *
 * The legacy POST validated body fields mid-handler after the volunteer
 * lookups (role-branched), so those checks and their exact messages live here
 * instead of in a route-level Zod schema.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import type { Session } from "@/infrastructure/auth/session";
import type {
  AttendanceRow,
  AttendanceWithVolunteer,
  VolunteerAttendanceRepository,
} from "../repositories/volunteer-attendance.repository.interface";
import type {
  CreateAttendanceBody,
  ListAttendancesQuery,
} from "../schemas/volunteer-attendance.schema";

const log = logger.child("volunteer-attendances");

export interface CreateAttendanceResult {
  row: AttendanceRow;
  /** true → HTTP 201 (recorded); false → HTTP 200 (idempotent duplicate). */
  created: boolean;
}

export class VolunteerAttendanceService {
  constructor(private readonly volunteerAttendanceRepository: VolunteerAttendanceRepository) {}

  /** GET /api/volunteer-attendances?volunteerId=&from=&to=&limit= */
  async list(query: ListAttendancesQuery, actor: Session): Promise<AttendanceWithVolunteer[]> {
    let volunteerId = query.volunteerId;
    // Volunteers only ever see their own register.
    if (actor.role === "VOLUNTEER") {
      const own = await this.volunteerAttendanceRepository.findVolunteerByUserId(actor.userId);
      if (!own) return [];
      volunteerId = own.id;
    }

    return this.volunteerAttendanceRepository.list({
      volunteerId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
      limit: query.limit,
    });
  }

  /**
   * POST /api/volunteer-attendances — role-branched: an ACTIVE volunteer
   * self-checks-in for today ({ taskId?, latitude?, longitude? }), an admin
   * records a volunteer day.
   */
  async create(actor: Session, body: CreateAttendanceBody): Promise<CreateAttendanceResult> {
    if (actor.role === "VOLUNTEER") {
      return this.selfCheckIn(actor, body);
    }
    return this.adminRecord(actor, body);
  }

  /** Volunteer self check-in — ACTIVE volunteers only, idempotent per day. */
  private async selfCheckIn(actor: Session, body: CreateAttendanceBody): Promise<CreateAttendanceResult> {
    const volunteer = await this.volunteerAttendanceRepository.findVolunteerByUserId(actor.userId);
    if (!volunteer || volunteer.status !== "ACTIVE") {
      log.warn("volunteer_checkin_blocked_inactive", {
        volunteerId: volunteer?.id,
        actor: actor.userId,
      });
      throw new ApiError("Only active volunteers can check in", 403);
    }

    let task: { title: string; location: string | null } | null = null;
    if (body?.taskId) {
      task = await this.volunteerAttendanceRepository.findTaskForVolunteer(
        String(body.taskId),
        volunteer.id
      );
      if (!task) {
        log.warn("volunteer_checkin_task_not_found", {
          volunteerId: volunteer.id,
          taskId: String(body.taskId),
          actor: actor.userId,
        });
        throw new ApiError("Task not found", 404);
      }
    }

    const now = new Date();
    const day = new Date(now.toISOString().slice(0, 10));
    const lat = Number(body?.latitude);
    const lng = Number(body?.longitude);
    const coords =
      Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(5)},${lng.toFixed(5)}` : null;
    const location = task?.location || coords;
    const notes = task ? `Self check-in · ${task.title}` : "Self check-in";

    const existing = await this.volunteerAttendanceRepository.findAttendanceByVolunteerAndDate(
      volunteer.id,
      day
    );
    // Idempotent: a second tap the same day keeps the first check-in time.
    if (existing?.checkIn) {
      log.warn("volunteer_checkin_duplicate", {
        attendanceId: existing.id,
        volunteerId: volunteer.id,
        actor: actor.userId,
      });
      return { row: existing, created: false };
    }

    const row = existing
      ? await this.volunteerAttendanceRepository.updateAttendance(existing.id, {
          checkIn: now,
          location: existing.location ?? location,
          notes: existing.notes ?? notes,
        })
      : await this.volunteerAttendanceRepository.createAttendance({
          volunteerId: volunteer.id,
          date: day,
          checkIn: now,
          location,
          notes,
        });
    log.info("volunteer_checkin_recorded", {
      attendanceId: row.id,
      volunteerId: volunteer.id,
      ...(body?.taskId ? { taskId: String(body.taskId) } : {}),
      actor: actor.userId,
    });
    return { row, created: true };
  }

  /** Admin day record — upserts the volunteer's attendance for one day. */
  private async adminRecord(actor: Session, body: CreateAttendanceBody): Promise<CreateAttendanceResult> {
    const volunteerId = String(body?.volunteerId ?? "");
    if (!volunteerId) throw new ApiError("volunteerId is required", 400);
    const volunteer = await this.volunteerAttendanceRepository.findVolunteerById(volunteerId);
    if (!volunteer) {
      log.warn("volunteer_attendance_volunteer_not_found", {
        volunteerId,
        actor: actor.userId,
      });
      throw new ApiError("Volunteer not found", 404);
    }

    const date = body?.date ? new Date(String(body.date)) : new Date();
    if (Number.isNaN(date.getTime())) throw new ApiError("Date is invalid", 400);
    const day = new Date(date.toISOString().slice(0, 10));

    const hoursInput =
      body?.hours !== undefined && body.hours !== null && String(body.hours).trim() !== ""
        ? Number(body.hours)
        : null;
    if (hoursInput !== null && (!Number.isFinite(hoursInput) || hoursInput < 0 || hoursInput > 24))
      throw new ApiError("Hours must be between 0 and 24", 400);

    const checkIn = body?.checkIn ? new Date(String(body.checkIn)) : null;
    const checkOut = body?.checkOut ? new Date(String(body.checkOut)) : null;

    // When the admin didn't type hours, derive them from the check-in/out pair.
    let hours: number | null = hoursInput;
    if (hours === null && checkIn && checkOut && checkOut.getTime() > checkIn.getTime()) {
      hours = Math.round(((checkOut.getTime() - checkIn.getTime()) / 3_600_000) * 100) / 100;
    }

    const location = body?.location ? String(body.location).trim() : null;
    const notes = body?.notes ? String(body.notes) : null;

    const row = await this.volunteerAttendanceRepository.upsertAttendance(volunteerId, day, {
      checkIn,
      checkOut,
      hours,
      location,
      notes,
    });

    log.info("volunteer_attendance_recorded", {
      attendanceId: row.id,
      volunteerId,
      date: day.toISOString().slice(0, 10),
      ...(hours !== null ? { hours } : {}),
      actor: actor.userId,
    });

    return { row, created: true };
  }
}
