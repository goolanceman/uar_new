/**
 * Camp staff routes — /api/camp-staff, /api/camp-staff/:id
 * Converted 1:1 from src/app/api/camp-staff/* (Next.js route handlers) to Express.
 * NOTE: DELETE /api/camp-staff?id=… keeps its query-parameter id (as in the
 * original route handler), so it is router.delete("/") not router.delete("/:id").
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { assertTransition } from "@/lib/workflow";
import { CAMP_STAFF_STATUSES, CAMP_STAFF_TRANSITIONS } from "@/lib/camp-staff";

export const router = Router();

const STAFF_ROLES = ["DOCTOR", "NURSE", "PHARMACIST", "LAB_TECH", "COORDINATOR", "VOLUNTEER"];
// Camp-staff roles that must map to a VERIFIED professional of the same kind
const CLINICAL_ROLES = ["DOCTOR", "NURSE", "PHARMACIST", "LAB_TECH"];

const VALID_STATUSES: readonly string[] = CAMP_STAFF_STATUSES;

function pageParams(sp: URLSearchParams) {
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const take = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "24", 10) || 24));
  return { page, take, skip: (page - 1) * take };
}

function envelope<T>(items: T[], total: number, page: number, take: number) {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

// GET /api/camp-staff?campId= — authenticated (camp roster)
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
    const campId = sp.get("campId") || undefined;
    const status = sp.get("status") || undefined;
    const { page, take, skip } = pageParams(sp);

    const where: Prisma.CampStaffWhereInput = {};
    if (campId) where.campId = campId;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      db.campStaff.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          professional: {
            select: { id: true, name: true, kind: true, speciality: true, verificationStatus: true },
          },
          camp: { select: { id: true, code: true, title: true, status: true } },
        },
      }),
      db.campStaff.count({ where }),
    ]);
    return json(res, envelope(items, total, page, take));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/camp-staff (ADMIN) {campId, professionalId?, volunteerId?, role}
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "HOSPITAL");
    const body = req.body ?? {};

    const campId = String(body.campId ?? "").trim();
    if (!campId) throw new ApiError("campId is required", 400);
    const camp = await db.medicalCamp.findUnique({ where: { id: campId } });
    if (!camp) throw new ApiError("Camp not found", 404);

    // A hospital partner rosters only its own staff on camps it has accepted.
    if (session.role === "HOSPITAL") {
      const org = await db.healthcareOrg.findUnique({ where: { ownerUserId: session.userId }, select: { id: true } });
      if (!org) throw new ApiError("No healthcare organisation is linked to your account", 403);
      const partner = await db.campPartner.findFirst({ where: { campId, orgId: org.id, status: "ACCEPTED" }, select: { id: true } });
      if (!partner) throw new ApiError("Accept the camp invitation before assigning staff", 403);
      if (body.volunteerId) throw new ApiError("Partners can assign only their own staff", 403);
      const own = body.professionalId
        ? await db.healthProfessional.findFirst({ where: { id: String(body.professionalId), orgId: org.id }, select: { id: true } })
        : null;
      if (!own) throw new ApiError("Partners can assign only their own staff", 403);
    }

    const role = String(body.role ?? "DOCTOR").trim().toUpperCase();
    if (!STAFF_ROLES.includes(role)) throw new ApiError("Invalid role", 400);

    const professionalId = body.professionalId ? String(body.professionalId).trim() : null;
    const volunteerId = body.volunteerId ? String(body.volunteerId).trim() : null;

    if (!professionalId && !volunteerId)
      throw new ApiError("professionalId or volunteerId is required", 400);

    if (professionalId) {
      const professional = await db.healthProfessional.findUnique({
        where: { id: professionalId },
      });
      if (!professional) throw new ApiError("Professional not found", 404);
      if (CLINICAL_ROLES.includes(role)) {
        if (professional.kind !== role)
          throw new ApiError(`This staff member is a ${professional.kind}, not a ${role}`, 400);
        if (professional.verificationStatus !== "VERIFIED")
          throw new ApiError(
            "Only verified professionals can be assigned to clinical roles",
            400
          );
      }
    }
    if (volunteerId) {
      const volunteer = await db.volunteer.findUnique({ where: { id: volunteerId } });
      if (!volunteer) throw new ApiError("Volunteer not found", 404);
    }

    const staff = await db.campStaff.create({
      data: {
        campId,
        professionalId,
        volunteerId,
        role,
        status: "ASSIGNED",
        notes: body.notes ? String(body.notes).trim() : null,
      },
      include: {
        professional: {
          select: { id: true, name: true, kind: true, speciality: true, verificationStatus: true },
        },
      },
    });

    await logActivity(
      session.name,
      "CAMP_STAFF_ADD",
      "CampStaff",
      `${staff.professional?.name ?? "Volunteer"} assigned as ${role} for ${camp.title}`,
      session.userId
    );
    return json(res, staff, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/camp-staff?id= (ADMIN) — remove from roster
router.delete("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const id = new URL(req.url, "http://localhost").searchParams.get("id");
    if (!id) throw new ApiError("id query parameter is required", 400);

    const staff = await db.campStaff.findUnique({
      where: { id },
      include: { professional: { select: { name: true } } },
    });
    if (!staff) throw new ApiError("Camp staff record not found", 404);

    await db.campStaff.delete({ where: { id } });

    await logActivity(
      session.name,
      "CAMP_STAFF_REMOVE",
      "CampStaff",
      `${staff.professional?.name ?? staff.role} removed from camp roster`,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/camp-staff/:id — ADMIN advances an assignment through camp day.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};
    const status = String(body.status ?? "").trim().toUpperCase();
    if (!VALID_STATUSES.includes(status))
      throw new ApiError("Invalid camp staff status", 400);

    const existing = await db.campStaff.findUnique({
      where: { id },
      include: {
        professional: { select: { name: true } },
        camp: { select: { title: true } },
      },
    });
    if (!existing) throw new ApiError("Camp staff record not found", 404);
    assertTransition(CAMP_STAFF_TRANSITIONS, existing.status, status, "camp staff assignment");

    const changed = await db.campStaff.updateMany({
      where: { id, status: existing.status },
      data: { status },
    });
    if (changed.count !== 1)
      throw new ApiError("Camp staff assignment changed while this action was being processed", 409);

    const updated = await db.campStaff.findUniqueOrThrow({
      where: { id },
      include: {
        professional: { select: { id: true, name: true, kind: true, speciality: true } },
      },
    });
    await logActivity(
      session.name,
      "CAMP_STAFF_STATUS",
      "CampStaff",
      `${existing.professional?.name ?? "Staff member"} · ${existing.camp.title} → ${status}`,
      session.userId
    );
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});
