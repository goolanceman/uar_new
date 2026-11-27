/**
 * Camp attendance service — the camp queue: check-in (idempotent, next queue
 * token per camp), live dashboard counters and status transitions. Depends
 * on the repository contract and the shared transition tables, throws
 * application errors, never touches HTTP.
 *
 * The legacy handlers validated body fields mid-handler after the auth gate
 * (with the registration/attendance/doctor lookups interleaved —
 * 404-before-400 ordering), so those checks and their exact messages live
 * here instead of in a route-level Zod schema.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import {
  ATTENDANCE_ACTIVE_STATUSES as ACTIVE_STATUSES,
  ATTENDANCE_PATCH_STATUSES as PATCH_STATUSES,
  ATTENDANCE_TRANSITIONS as TRANSITIONS,
} from "@/modules/camp-attendance/services/camp-attendance.domain";
import type {
  AttendanceCheckInData,
  AttendanceListRow,
  AttendanceUpdateData,
  CampAttendanceRepository,
  CampAttendanceRow,
  CampScope,
  RegistrationWithCamp,
} from "../repositories/camp-attendance.repository.interface";
import type {
  CheckInBody,
  ListCampAttendanceQuery,
  UpdateAttendanceBody,
} from "../schemas/camp-attendance.schema";

const log = logger.child("camp-attendance");

const CHECKIN_METHODS = ["QR", "ID", "PHONE", "MANUAL"];

export interface AttendanceSummary {
  registered: number;
  checkedIn: number;
  waiting: number;
  inConsultation: number;
  completed: number;
  checkedOut: number;
  noShow: number;
  cancelled: number;
}

export interface AttendanceEnvelope {
  items: AttendanceListRow[];
  total: number;
  page: number;
  pages: number;
}

function envelope(items: AttendanceListRow[], total: number, page: number, take: number): AttendanceEnvelope {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

export class CampAttendanceService {
  constructor(private readonly campAttendanceRepository: CampAttendanceRepository) {}

  /**
   * GET /api/camp-attendance?campId&status  |  ?campId&summary=1 (live
   * dashboard counters) — ADMIN | VOLUNTEER all camps; HOSPITAL only camps
   * its org partners.
   */
  async list(
    query: ListCampAttendanceQuery,
    actor: Session
  ): Promise<AttendanceSummary | AttendanceEnvelope> {
    let orgScopedCamp: CampScope | undefined;
    if (actor.role === "HOSPITAL") {
      const ownOrgId = await this.campAttendanceRepository.findOrgIdByOwner(actor.userId);
      if (!ownOrgId) {
        if (query.summary) return { registered: 0, checkedIn: 0, waiting: 0, inConsultation: 0, completed: 0, checkedOut: 0, noShow: 0, cancelled: 0 };
        return envelope([], 0, 1, 24);
      }
      orgScopedCamp = { campPartners: { some: { orgId: ownOrgId } } };
    }

    // ── Live dashboard summary for one camp ────────────────────────────────
    if (query.summary) {
      if (!query.campId) throw new ApiError("campId is required for summary", 400);
      if (actor.role === "HOSPITAL") {
        const owns = await this.campAttendanceRepository.campInScope(query.campId, orgScopedCamp);
        if (!owns) throw new ApiError("You do not have permission for this action", 403);
      }
      const [registrations, attGroup] = await Promise.all([
        this.campAttendanceRepository.countActiveRegistrations(query.campId),
        this.campAttendanceRepository.attendanceStatusCounts(query.campId),
      ]);
      const byStatus = new Map(attGroup.map((r) => [r.status, r.count]));
      return {
        registered: registrations,
        checkedIn: byStatus.get("CHECKED_IN") ?? 0,
        waiting: byStatus.get("WAITING") ?? 0,
        inConsultation: byStatus.get("IN_CONSULTATION") ?? 0,
        completed: byStatus.get("COMPLETED") ?? 0,
        checkedOut: byStatus.get("CHECKED_OUT") ?? 0,
        noShow: byStatus.get("NO_SHOW") ?? 0,
        cancelled: byStatus.get("CANCELLED") ?? 0,
      };
    }

    // ── Queue listing (ordered by queue token) ─────────────────────────────
    const [items, total] = await Promise.all([
      this.campAttendanceRepository.list(
        { campId: query.campId, status: query.status },
        orgScopedCamp,
        (query.page - 1) * query.limit,
        query.limit
      ),
      this.campAttendanceRepository.count({ campId: query.campId, status: query.status }, orgScopedCamp),
    ]);
    return envelope(items, total, query.page, query.limit);
  }

  /**
   * POST /api/camp-attendance (ADMIN | VOLUNTEER | NURSE) {registrationId,
   * method?} — the CHECK-IN: idempotent, assigns the next queue token per
   * camp (re-used registrations keep their token).
   */
  async checkIn(body: CheckInBody, actor: Session): Promise<CampAttendanceRow> {
    const registrationId = String(body.registrationId ?? "").trim();
    if (!registrationId) throw new ApiError("registrationId is required", 400);

    const method = String(body.method ?? "MANUAL").trim().toUpperCase();
    if (!CHECKIN_METHODS.includes(method)) throw new ApiError("Invalid check-in method", 400);

    const registration = await this.campAttendanceRepository.findRegistrationFull(registrationId);
    if (!registration) {
      log.warn("camp_checkin_registration_not_found", {
        registrationId,
        actor: actor.userId,
      });
      throw new ApiError("Registration not found", 404);
    }

    if (!["LIVE", "SCHEDULED"].includes(registration.camp.status)) {
      log.warn("camp_checkin_blocked_camp_status", {
        registrationId,
        campId: registration.campId,
        campStatus: registration.camp.status,
        actor: actor.userId,
      });
      throw new ApiError(`Camp is ${registration.camp.status} — check-in requires LIVE or SCHEDULED`, 409);
    }

    if (["CANCELLED", "REJECTED"].includes(registration.status)) {
      log.warn("camp_checkin_blocked_registration_status", {
        registrationId,
        registrationStatus: registration.status,
        actor: actor.userId,
      });
      throw new ApiError(`Registration is ${registration.status} — check-in not allowed`, 409);
    }

    const existing = registration.attendance;
    if (existing && ACTIVE_STATUSES.includes(existing.status)) {
      log.warn("camp_checkin_duplicate", {
        registrationId,
        attendanceId: existing.id,
        attendanceStatus: existing.status,
        actor: actor.userId,
      });
      throw new ApiError("Already checked in", 409);
    }

    // Next token = (max queue token) per camp + 1 (re-used registrations keep their token)
    const maxToken = await this.campAttendanceRepository.aggregateMaxQueueToken(registration.campId);
    const queueToken = existing?.queueToken ?? (maxToken ?? 0) + 1;

    const data: AttendanceCheckInData = {
      status: "CHECKED_IN",
      checkInAt: new Date(),
      checkInMethod: method,
      operatorName: actor.name,
      queueToken,
      cancelReason: null,
    };

    const attendance = existing
      ? await this.campAttendanceRepository.update(existing.id, data)
      : await this.campAttendanceRepository.create({
          registrationId: registration.id,
          campId: registration.campId,
          beneficiaryId: registration.beneficiaryId,
          ...data,
        });

    log.info("camp_checkin_recorded", {
      attendanceId: attendance.id,
      registrationId: registration.id,
      campId: registration.campId,
      queueToken,
      method,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "ATTENDANCE_CHECKIN",
      "CampAttendance",
      `${registration.code} checked in at ${registration.camp.title} (token ${queueToken}, ${method})`,
      actor.userId
    );
    return attendance;
  }

  /**
   * PATCH /api/camp-attendance (ADMIN | VOLUNTEER | NURSE | DOCTOR)
   * {id, status: WAITING|IN_CONSULTATION|COMPLETED|CHECKED_OUT|NO_SHOW|
   * CANCELLED, doctorId?, cancelReason?} — NO_SHOW only from
   * CHECKED_IN/WAITING · CANCELLED requires cancelReason · CHECKED_OUT (sets
   * checkOutAt) only from COMPLETED · COMPLETED does NOT check out.
   */
  async update(body: UpdateAttendanceBody, actor: Session): Promise<CampAttendanceRow> {
    const id = String(body.id ?? "").trim();
    if (!id) throw new ApiError("id is required", 400);

    const attendance = await this.campAttendanceRepository.findAttendanceWithRegistrationCode(id);
    if (!attendance) {
      log.warn("camp_attendance_update_not_found", { attendanceId: id, actor: actor.userId });
      throw new ApiError("Attendance record not found", 404);
    }

    const status = String(body.status ?? "").trim().toUpperCase();
    if (!PATCH_STATUSES.includes(status))
      throw new ApiError("Invalid status", 400);
    if (!TRANSITIONS[attendance.status]?.includes(status)) {
      log.warn("camp_attendance_invalid_transition", {
        attendanceId: id,
        from: attendance.status,
        to: status,
        actor: actor.userId,
      });
      throw new ApiError(
        `Cannot move attendance from ${attendance.status} to ${status}`,
        409
      );
    }

    const data: AttendanceUpdateData = { status };

    if (status === "CANCELLED") {
      const cancelReason = String(body.cancelReason ?? "").trim();
      if (!cancelReason)
        throw new ApiError("cancelReason is required when cancelling attendance", 400);
      data.cancelReason = cancelReason;
    }
    if (status === "CHECKED_OUT") data.checkOutAt = new Date();

    if (body.doctorId !== undefined) {
      if (body.doctorId === null || String(body.doctorId).trim() === "") {
        data.doctorId = null;
      } else {
        const doctor = await this.campAttendanceRepository.findDoctorById(
          String(body.doctorId).trim()
        );
        if (!doctor) {
          log.warn("camp_attendance_doctor_not_found", {
            attendanceId: id,
            doctorId: String(body.doctorId).trim(),
            actor: actor.userId,
          });
          throw new ApiError("Doctor not found", 404);
        }
        data.doctorId = doctor.id;
      }
    }

    const updated = await this.campAttendanceRepository.update(id, data);

    log.info("camp_attendance_updated", {
      attendanceId: id,
      newStatus: updated.status,
      campId: attendance.campId,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "ATTENDANCE_UPDATE",
      "CampAttendance",
      `${attendance.registration.code} → ${status}`,
      actor.userId
    );
    return updated;
  }
}
