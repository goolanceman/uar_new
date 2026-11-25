/**
 * Camp attendance routes — /api/camp-attendance
 * Converted 1:1 from src/app/api/camp-attendance/route.ts (Next.js route handler) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import {
  ATTENDANCE_ACTIVE_STATUSES as ACTIVE_STATUSES,
  ATTENDANCE_PATCH_STATUSES as PATCH_STATUSES,
  ATTENDANCE_TRANSITIONS as TRANSITIONS,
} from "@/lib/camp-attendance";

export const router = Router();

const CHECKIN_METHODS = ["QR", "ID", "PHONE", "MANUAL"];

function pageParams(sp: URLSearchParams) {
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const take = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "24", 10) || 24));
  return { page, take, skip: (page - 1) * take };
}

function envelope<T>(items: T[], total: number, page: number, take: number) {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

async function hospitalOrgId(userId: string): Promise<string | null> {
  const org = await db.healthcareOrg.findUnique({ where: { ownerUserId: userId } });
  return org?.id ?? null;
}

// GET /api/camp-attendance?campId&status  |  ?campId&summary=1 (live dashboard counters)
// ADMIN | VOLUNTEER all camps; HOSPITAL only camps its org partners.
router.get("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER", "HOSPITAL", "DOCTOR", "NURSE");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const campId = sp.get("campId") || undefined;
    const status = sp.get("status") || undefined;

    let orgScopedCamp: Prisma.MedicalCampWhereInput | undefined;
    if (session.role === "HOSPITAL") {
      const ownOrgId = await hospitalOrgId(session.userId);
      if (!ownOrgId) {
        if (sp.get("summary") === "1") return json(res, { registered: 0, checkedIn: 0, waiting: 0, inConsultation: 0, completed: 0, checkedOut: 0, noShow: 0, cancelled: 0 });
        return json(res, envelope([], 0, 1, 24));
      }
      orgScopedCamp = { campPartners: { some: { orgId: ownOrgId } } };
    }

    // ── Live dashboard summary for one camp ────────────────────────────────
    if (sp.get("summary") === "1") {
      if (!campId) throw new ApiError("campId is required for summary", 400);
      if (session.role === "HOSPITAL") {
        const owns = await db.medicalCamp.findFirst({
          where: { id: campId, ...(orgScopedCamp ?? {}) },
        });
        if (!owns) throw new ApiError("You do not have permission for this action", 403);
      }
      const [registrations, attGroup] = await Promise.all([
        db.campRegistration.count({
          where: { campId, status: { notIn: ["CANCELLED", "REJECTED"] } },
        }),
        db.campAttendance.groupBy({ by: ["status"], where: { campId }, _count: { _all: true } }),
      ]);
      const byStatus = new Map(attGroup.map((r) => [r.status, r._count._all]));
      return json(res, {
        registered: registrations,
        checkedIn: byStatus.get("CHECKED_IN") ?? 0,
        waiting: byStatus.get("WAITING") ?? 0,
        inConsultation: byStatus.get("IN_CONSULTATION") ?? 0,
        completed: byStatus.get("COMPLETED") ?? 0,
        checkedOut: byStatus.get("CHECKED_OUT") ?? 0,
        noShow: byStatus.get("NO_SHOW") ?? 0,
        cancelled: byStatus.get("CANCELLED") ?? 0,
      });
    }

    // ── Queue listing (ordered by queue token) ─────────────────────────────
    const { page, take, skip } = pageParams(sp);
    const where: Prisma.CampAttendanceWhereInput = {};
    if (campId) where.campId = campId;
    if (status) where.status = status;
    if (orgScopedCamp) where.camp = orgScopedCamp;

    const [items, total] = await Promise.all([
      db.campAttendance.findMany({
        where,
        orderBy: [{ queueToken: "asc" }, { checkInAt: "asc" }],
        skip,
        take,
        include: {
          beneficiary: {
            select: { id: true, code: true, name: true, phone: true, age: true, gender: true },
          },
          registration: { select: { id: true, code: true, status: true } },
        },
      }),
      db.campAttendance.count({ where }),
    ]);
    return json(res, envelope(items, total, page, take));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/camp-attendance (ADMIN | VOLUNTEER | NURSE) {registrationId, method?}
// The CHECK-IN: idempotent, assigns the next queue token per camp.
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER", "NURSE");
    const body = req.body ?? {};

    const registrationId = String(body.registrationId ?? "").trim();
    if (!registrationId) throw new ApiError("registrationId is required", 400);

    const method = String(body.method ?? "MANUAL").trim().toUpperCase();
    if (!CHECKIN_METHODS.includes(method)) throw new ApiError("Invalid check-in method", 400);

    const registration = await db.campRegistration.findUnique({
      where: { id: registrationId },
      include: { camp: true, attendance: true },
    });
    if (!registration) throw new ApiError("Registration not found", 404);

    if (!["LIVE", "SCHEDULED"].includes(registration.camp.status))
      throw new ApiError(`Camp is ${registration.camp.status} — check-in requires LIVE or SCHEDULED`, 409);

    if (["CANCELLED", "REJECTED"].includes(registration.status))
      throw new ApiError(`Registration is ${registration.status} — check-in not allowed`, 409);

    const existing = registration.attendance;
    if (existing && ACTIVE_STATUSES.includes(existing.status))
      throw new ApiError("Already checked in", 409);

    // Next token = max(queueToken) per camp + 1 (re-used registrations keep their token)
    const maxAgg = await db.campAttendance.aggregate({
      where: { campId: registration.campId },
      _max: { queueToken: true },
    });
    const queueToken =
      existing?.queueToken ?? (maxAgg._max.queueToken ?? 0) + 1;

    const data = {
      status: "CHECKED_IN" as const,
      checkInAt: new Date(),
      checkInMethod: method,
      operatorName: session.name,
      queueToken,
      cancelReason: null,
    };

    const attendance = existing
      ? await db.campAttendance.update({ where: { id: existing.id }, data })
      : await db.campAttendance.create({
          data: {
            registrationId: registration.id,
            campId: registration.campId,
            beneficiaryId: registration.beneficiaryId,
            ...data,
          },
        });

    await logActivity(
      session.name,
      "ATTENDANCE_CHECKIN",
      "CampAttendance",
      `${registration.code} checked in at ${registration.camp.title} (token ${queueToken}, ${method})`,
      session.userId
    );
    return json(res, attendance, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/camp-attendance (ADMIN | VOLUNTEER | NURSE | DOCTOR)
// {id, status: WAITING|IN_CONSULTATION|COMPLETED|CHECKED_OUT|NO_SHOW|CANCELLED, doctorId?, cancelReason?}
// NO_SHOW only from CHECKED_IN/WAITING · CANCELLED requires cancelReason ·
// CHECKED_OUT (sets checkOutAt) only from COMPLETED · COMPLETED does NOT check out.
router.patch("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER", "NURSE", "DOCTOR");
    const body = req.body ?? {};

    const id = String(body.id ?? "").trim();
    if (!id) throw new ApiError("id is required", 400);

    const attendance = await db.campAttendance.findUnique({
      where: { id },
      include: { registration: { select: { code: true } } },
    });
    if (!attendance) throw new ApiError("Attendance record not found", 404);

    const status = String(body.status ?? "").trim().toUpperCase();
    if (!PATCH_STATUSES.includes(status))
      throw new ApiError("Invalid status", 400);
    if (!TRANSITIONS[attendance.status]?.includes(status))
      throw new ApiError(
        `Cannot move attendance from ${attendance.status} to ${status}`,
        409
      );

    const data: {
      status: string;
      checkOutAt?: Date;
      cancelReason?: string | null;
      doctorId?: string | null;
    } = { status };

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
        const doctor = await db.healthProfessional.findUnique({
          where: { id: String(body.doctorId).trim() },
        });
        if (!doctor) throw new ApiError("Doctor not found", 404);
        data.doctorId = doctor.id;
      }
    }

    const updated = await db.campAttendance.update({ where: { id }, data });

    await logActivity(
      session.name,
      "ATTENDANCE_UPDATE",
      "CampAttendance",
      `${attendance.registration.code} → ${status}`,
      session.userId
    );
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});
