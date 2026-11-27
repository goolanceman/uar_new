/**
 * Appointment service — booking and patient-visit workflow rules. Depends on
 * the repository contract, throws application errors, never touches HTTP.
 * Field checks keep their exact legacy messages and ordering (404-before-400
 * interleaving with DB lookups preserved).
 */
import { logger } from "@/lib/logger";
import { assertTransition } from "@/lib/workflow";
import { logActivity, type Session } from "@/lib/session";
import { ApiError, NotFoundError } from "@/shared/errors";
import type {
  AppointmentListScope,
  AppointmentRepository,
  CreateAppointmentData,
  UpdateAppointmentData,
} from "../repositories/appointment.repository.interface";
import type { ListAppointmentsQuery } from "../schemas/appointment.schema";

const log = logger.child("appointments");

const APPT_TYPES = ["SCREENING", "CONSULTATION", "LAB", "PHARMACY", "FOLLOW_UP"];

const SETTABLE_STATUSES = ["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"];
// Patient-visit machine: SCHEDULED/PENDING (legacy rows) open; CONFIRMED adds
// visit outcomes; COMPLETED/CANCELLED/NO_SHOW are terminal — no reopen.
// Matches the queue UI: confirm from PENDING/SCHEDULED, complete/cancel/no-show
// from PENDING/SCHEDULED/CONFIRMED.
const TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  PENDING: ["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export interface AppointmentListPayload {
  items: unknown[];
  total: number;
  page: number;
  pages: number;
}

export class AppointmentService {
  constructor(private readonly appointmentRepository: AppointmentRepository) {}

  /**
   * GET /api/appointments?campId&beneficiaryId&professionalId&type&status&from&to
   * BENEFICIARY sees only appointments of their own patient record.
   */
  async list(session: Session, query: ListAppointmentsQuery): Promise<AppointmentListPayload> {
    const { page, limit } = query;
    const take = limit;
    const skip = (page - 1) * take;

    const scope: AppointmentListScope = {};
    if (query.campId) scope.campId = query.campId;
    if (query.beneficiaryId) scope.beneficiaryId = query.beneficiaryId;
    if (query.professionalId) scope.professionalId = query.professionalId;
    if (query.type) scope.type = query.type;
    if (query.status) scope.status = query.status;
    if (session.role === "BENEFICIARY") {
      const own = await this.appointmentRepository.findBeneficiaryByUser(session.userId);
      if (!own) return { items: [], total: 0, page, pages: Math.max(1, Math.ceil(0 / take)) };
      scope.beneficiaryId = own.id;
    }
    if (query.from || query.to) {
      scope.scheduledAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      };
    }

    const { items, total } = await this.appointmentRepository.list(scope, skip, take);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
  }

  /**
   * POST /api/appointments (ADMIN | VOLUNTEER | DOCTOR)
   * {campId?, beneficiaryId, professionalId?, type, scheduledAt, notes?}
   * A DOCTOR creating without professionalId is auto-linked to their own record.
   */
  async create(body: Record<string, unknown>, session: Session): Promise<unknown> {
    const beneficiaryId = String(body.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await this.appointmentRepository.findBeneficiaryById(beneficiaryId);
    if (!beneficiary) {
      log.warn("appointment_beneficiary_not_found", {
        beneficiaryId,
        actor: session.userId,
      });
      throw new NotFoundError("Beneficiary not found");
    }

    if (body.campId) {
      const camp = await this.appointmentRepository.findCampById(String(body.campId));
      if (!camp) {
        log.warn("appointment_camp_not_found", {
          campId: String(body.campId),
          actor: session.userId,
        });
        throw new NotFoundError("Camp not found");
      }
    }

    let professionalId = body.professionalId ? String(body.professionalId).trim() : null;
    if (professionalId) {
      const professional = await this.appointmentRepository.findProfessionalById(professionalId);
      if (!professional) {
        log.warn("appointment_professional_not_found", {
          professionalId,
          actor: session.userId,
        });
        throw new NotFoundError("Professional not found");
      }
    } else if (session.role === "DOCTOR") {
      const own = await this.appointmentRepository.findProfessionalByUser(session.userId);
      professionalId = own?.id ?? null;
    }

    const type = String(body.type ?? "CONSULTATION").trim().toUpperCase();
    if (!APPT_TYPES.includes(type)) throw new ApiError("Invalid type", 400);

    if (!body.scheduledAt) throw new ApiError("scheduledAt is required", 400);
    const scheduledAt = new Date(String(body.scheduledAt));
    if (Number.isNaN(scheduledAt.getTime()))
      throw new ApiError("scheduledAt is not a valid date", 400);

    const data: CreateAppointmentData = {
      campId: body.campId ? String(body.campId) : null,
      beneficiaryId,
      professionalId,
      type,
      scheduledAt,
      notes: body.notes ? String(body.notes).trim() : null,
      status: "SCHEDULED",
      createdByName: session.name,
    };
    const appointment = await this.appointmentRepository.create(data);

    log.info("appointment_created", {
      appointmentId: (appointment as { id: string }).id,
      beneficiaryId,
      ...(body.campId ? { campId: String(body.campId) } : {}),
      ...(professionalId ? { professionalId } : {}),
      type,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "APPOINTMENT_CREATE",
      "Appointment",
      `${type} for ${beneficiary.name} at ${scheduledAt.toISOString().slice(0, 16).replace("T", " ")}`,
      session.userId
    );
    return appointment;
  }

  /** GET /api/appointments/:id — ADMIN | VOLUNTEER | DOCTOR. */
  async get(id: string): Promise<unknown> {
    const appointment = await this.appointmentRepository.findByIdWithDetail(id);
    if (!appointment) throw new NotFoundError("Appointment not found");
    return appointment;
  }

  /**
   * PATCH /api/appointments/:id (ADMIN | VOLUNTEER | DOCTOR)
   * {status: CONFIRMED|COMPLETED|CANCELLED|NO_SHOW, noShowReason?, professionalId?, scheduledAt?}
   */
  async update(
    id: string,
    body: Record<string, unknown>,
    session: Session
  ): Promise<unknown> {
    const existing = await this.appointmentRepository.findById(id);
    if (!existing) {
      log.warn("appointment_update_not_found", { appointmentId: id, actor: session.userId });
      throw new NotFoundError("Appointment not found");
    }

    const data: UpdateAppointmentData = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!SETTABLE_STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      if (existing.status !== status && !TRANSITIONS[existing.status]?.includes(status))
        log.warn("appointment_invalid_transition", {
          appointmentId: id,
          from: existing.status,
          to: status,
          actor: session.userId,
        });
      assertTransition(TRANSITIONS, existing.status, status, "appointment");
      if (status === "NO_SHOW") {
        const reason = String(body.noShowReason ?? "").trim();
        if (!reason)
          throw new ApiError("noShowReason is required when marking a no-show", 400);
        data.noShowReason = reason;
      }
      data.status = status;
    } else if (body.noShowReason !== undefined) {
      data.noShowReason = body.noShowReason ? String(body.noShowReason).trim() : null;
    }

    if (body.professionalId !== undefined) {
      if (body.professionalId === null || String(body.professionalId).trim() === "") {
        data.professionalId = null;
      } else {
        const professional = await this.appointmentRepository.findProfessionalById(
          String(body.professionalId).trim()
        );
        if (!professional) {
          log.warn("appointment_professional_not_found", {
            professionalId: String(body.professionalId).trim(),
            appointmentId: id,
            actor: session.userId,
          });
          throw new NotFoundError("Professional not found");
        }
        data.professionalId = professional.id;
      }
    }
    if (body.scheduledAt !== undefined) {
      const scheduledAt = new Date(String(body.scheduledAt));
      if (Number.isNaN(scheduledAt.getTime()))
        throw new ApiError("scheduledAt is not a valid date", 400);
      data.scheduledAt = scheduledAt;
    }
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const appointment = await this.appointmentRepository.update(id, data);

    log.info("appointment_updated", {
      appointmentId: id,
      fields: Object.keys(data),
      ...(data.status !== undefined ? { newStatus: appointment.status } : {}),
      actor: session.userId,
    });

    if (appointment.status === "NO_SHOW") {
      await logActivity(
        session.name,
        "APPOINTMENT_NOSHOW",
        "Appointment",
        `Appointment ${appointment.id} marked NO_SHOW — ${appointment.noShowReason ?? ""}`,
        session.userId
      );
    } else if (body.status !== undefined) {
      await logActivity(
        session.name,
        "APPOINTMENT_UPDATE",
        "Appointment",
        `Appointment ${appointment.id} → ${appointment.status}`,
        session.userId
      );
    }
    return appointment;
  }

  /** DELETE /api/appointments/:id (ADMIN) — only while still SCHEDULED. */
  async remove(id: string, session: Session): Promise<{ ok: boolean }> {
    const existing = await this.appointmentRepository.findById(id);
    if (!existing) {
      log.warn("appointment_delete_not_found", { appointmentId: id, actor: session.userId });
      throw new NotFoundError("Appointment not found");
    }
    if (existing.status !== "SCHEDULED") {
      log.warn("appointment_delete_blocked_status", {
        appointmentId: id,
        status: existing.status,
        actor: session.userId,
      });
      throw new ApiError("Only appointments in SCHEDULED status can be deleted", 409);
    }

    await this.appointmentRepository.delete(id);

    log.info("appointment_deleted", {
      appointmentId: id,
      type: existing.type,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "APPOINTMENT_DELETE",
      "Appointment",
      `${existing.type} appointment for beneficiary ${existing.beneficiaryId} deleted`,
      session.userId
    );
    return { ok: true };
  }
}
