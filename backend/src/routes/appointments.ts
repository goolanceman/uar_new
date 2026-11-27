/**
 * Appointment routes — /api/appointments, /api/appointments/:id
 * Converted 1:1 from src/app/api/appointments/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { assertTransition } from "@/lib/workflow";

export const router = Router();

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

function pageParams(sp: URLSearchParams) {
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const take = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "24", 10) || 24));
  return { page, take, skip: (page - 1) * take };
}

function envelope<T>(items: T[], total: number, page: number, take: number) {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

// GET /api/appointments?campId&beneficiaryId&professionalId&type&status&from&to
// BENEFICIARY sees only appointments of their own patient record.
router.get("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER", "DOCTOR", "NURSE", "BENEFICIARY");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const campId = sp.get("campId") || undefined;
    const beneficiaryId = sp.get("beneficiaryId") || undefined;
    const professionalId = sp.get("professionalId") || undefined;
    const type = sp.get("type") || undefined;
    const status = sp.get("status") || undefined;
    const from = sp.get("from");
    const to = sp.get("to");
    const { page, take, skip } = pageParams(sp);

    const where: Prisma.AppointmentWhereInput = {};
    if (campId) where.campId = campId;
    if (beneficiaryId) where.beneficiaryId = beneficiaryId;
    if (professionalId) where.professionalId = professionalId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({ where: { userId: session.userId }, select: { id: true } });
      if (!own) return json(res, envelope([], 0, page, take));
      where.beneficiaryId = own.id;
    }
    if (from || to) {
      where.scheduledAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      db.appointment.findMany({
        where,
        orderBy: { scheduledAt: "desc" },
        skip,
        take,
        include: {
          beneficiary: { select: { id: true, code: true, name: true, phone: true } },
          professional: { select: { id: true, name: true, kind: true, speciality: true } },
          camp: { select: { id: true, code: true, title: true } },
        },
      }),
      db.appointment.count({ where }),
    ]);
    return json(res, envelope(items, total, page, take));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/appointments (ADMIN | VOLUNTEER | DOCTOR)
// {campId?, beneficiaryId, professionalId?, type, scheduledAt, notes?}
// A DOCTOR creating without professionalId is auto-linked to their own record.
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER", "DOCTOR");
    const body = req.body ?? {};

    const beneficiaryId = String(body.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await db.beneficiary.findUnique({ where: { id: beneficiaryId } });
    if (!beneficiary) {
      log.warn("appointment_beneficiary_not_found", {
        beneficiaryId,
        actor: session.userId,
      });
      throw new ApiError("Beneficiary not found", 404);
    }

    if (body.campId) {
      const camp = await db.medicalCamp.findUnique({ where: { id: String(body.campId) } });
      if (!camp) {
        log.warn("appointment_camp_not_found", {
          campId: String(body.campId),
          actor: session.userId,
        });
        throw new ApiError("Camp not found", 404);
      }
    }

    let professionalId = body.professionalId ? String(body.professionalId).trim() : null;
    if (professionalId) {
      const professional = await db.healthProfessional.findUnique({ where: { id: professionalId } });
      if (!professional) {
        log.warn("appointment_professional_not_found", {
          professionalId,
          actor: session.userId,
        });
        throw new ApiError("Professional not found", 404);
      }
    } else if (session.role === "DOCTOR") {
      const own = await db.healthProfessional.findUnique({ where: { userId: session.userId } });
      professionalId = own?.id ?? null;
    }

    const type = String(body.type ?? "CONSULTATION").trim().toUpperCase();
    if (!APPT_TYPES.includes(type)) throw new ApiError("Invalid type", 400);

    if (!body.scheduledAt) throw new ApiError("scheduledAt is required", 400);
    const scheduledAt = new Date(String(body.scheduledAt));
    if (Number.isNaN(scheduledAt.getTime()))
      throw new ApiError("scheduledAt is not a valid date", 400);

    const appointment = await db.appointment.create({
      data: {
        campId: body.campId ? String(body.campId) : null,
        beneficiaryId,
        professionalId,
        type,
        scheduledAt,
        notes: body.notes ? String(body.notes).trim() : null,
        status: "SCHEDULED",
        createdByName: session.name,
      },
      include: {
        beneficiary: { select: { id: true, code: true, name: true, phone: true } },
        professional: { select: { id: true, name: true, kind: true, speciality: true } },
      },
    });

    log.info("appointment_created", {
      appointmentId: appointment.id,
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
    return json(res, appointment, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/appointments/:id — ADMIN | VOLUNTEER | DOCTOR
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER", "DOCTOR");
    const { id } = req.params;
    const appointment = await db.appointment.findUnique({
      where: { id },
      include: {
        beneficiary: {
          select: { id: true, code: true, name: true, phone: true, age: true, gender: true },
        },
        professional: { select: { id: true, name: true, kind: true, speciality: true } },
        camp: { select: { id: true, code: true, title: true, status: true } },
      },
    });
    if (!appointment) throw new ApiError("Appointment not found", 404);
    return json(res, appointment);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/appointments/:id (ADMIN | VOLUNTEER | DOCTOR)
// {status: CONFIRMED|COMPLETED|CANCELLED|NO_SHOW, noShowReason?, professionalId?, scheduledAt?}
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER", "DOCTOR");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.appointment.findUnique({ where: { id } });
    if (!existing) {
      log.warn("appointment_update_not_found", { appointmentId: id, actor: session.userId });
      throw new ApiError("Appointment not found", 404);
    }

    const data: {
      status?: string;
      noShowReason?: string | null;
      professionalId?: string | null;
      scheduledAt?: Date;
      notes?: string | null;
    } = {};

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
        const professional = await db.healthProfessional.findUnique({
          where: { id: String(body.professionalId).trim() },
        });
        if (!professional) {
          log.warn("appointment_professional_not_found", {
            professionalId: String(body.professionalId).trim(),
            appointmentId: id,
            actor: session.userId,
          });
          throw new ApiError("Professional not found", 404);
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

    const appointment = await db.appointment.update({ where: { id }, data });

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
    return json(res, appointment);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/appointments/:id (ADMIN) — only while still SCHEDULED
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.appointment.findUnique({ where: { id } });
    if (!existing) {
      log.warn("appointment_delete_not_found", { appointmentId: id, actor: session.userId });
      throw new ApiError("Appointment not found", 404);
    }
    if (existing.status !== "SCHEDULED") {
      log.warn("appointment_delete_blocked_status", {
        appointmentId: id,
        status: existing.status,
        actor: session.userId,
      });
      throw new ApiError("Only appointments in SCHEDULED status can be deleted", 409);
    }

    await db.appointment.delete({ where: { id } });

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
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
