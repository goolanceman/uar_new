/**
 * Camp registration routes — /api/camp-registrations, /api/camp-registrations/:id
 * Converted 1:1 from src/app/api/camp-registrations/* (Next.js route handlers) to Express.
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
import { nextCampRegCode } from "@/lib/health-codes";
import { assertTransition } from "@/lib/workflow";

export const router = Router();

const REGISTERED_VIA = ["SELF", "DESK", "ASSISTED", "BULK", "QR"];
const REG_STATUSES = ["REGISTERED", "CONFIRMED", "CANCELLED", "REJECTED"];
/** Registration statuses that count against camp capacity */
const BLOCKING_STATUSES = ["CANCELLED", "REJECTED"];

const SETTABLE_STATUSES = ["REGISTERED", "CONFIRMED", "CANCELLED", "REJECTED"];
// Registration machine: confirm/reject while REGISTERED; cancel while anything
// but CANCELLED (the camp-ops UI offers Cancel on every non-cancelled row,
// including rejected ones); CANCELLED is terminal.
const TRANSITIONS: Record<string, string[]> = {
  REGISTERED: ["CONFIRMED", "CANCELLED", "REJECTED"],
  PENDING: ["CONFIRMED", "CANCELLED", "REJECTED"],
  CONFIRMED: ["CANCELLED"],
  REJECTED: ["CANCELLED"],
  CANCELLED: [],
};

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

const BENEFICIARY_SELECT = { id: true, code: true, name: true, phone: true, age: true, gender: true };

// GET /api/camp-registrations?q&campId&status&page&limit
// ADMIN | VOLUNTEER all; HOSPITAL only camps its org partners; BENEFICIARY own.
router.get("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER", "HOSPITAL", "DOCTOR", "NURSE", "BENEFICIARY");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const q = sp.get("q")?.trim() || undefined;
    const campId = sp.get("campId") || undefined;
    const status = sp.get("status") || undefined;
    const { page, take, skip } = pageParams(sp);

    const where: Prisma.CampRegistrationWhereInput = {};
    if (campId) where.campId = campId;
    if (status) where.status = status;
    if (q) {
      where.beneficiary = {
        OR: [{ name: { contains: q } }, { code: { contains: q } }],
      };
    }
    if (session.role === "HOSPITAL") {
      const ownOrgId = await hospitalOrgId(session.userId);
      if (!ownOrgId) return json(res, envelope([], 0, page, take));
      where.camp = { campPartners: { some: { orgId: ownOrgId } } };
    }
    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({ where: { userId: session.userId }, select: { id: true } });
      if (!own) return json(res, envelope([], 0, page, take));
      where.beneficiaryId = own.id;
    }

    const [items, total] = await Promise.all([
      db.campRegistration.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: { beneficiary: { select: BENEFICIARY_SELECT } },
      }),
      db.campRegistration.count({ where }),
    ]);
    return json(res, envelope(items, total, page, take));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/camp-registrations (ADMIN | VOLUNTEER | NURSE desk; BENEFICIARY self-service)
// {campId, beneficiaryId, registeredVia?, scheduledSlot?, notes?}
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER", "NURSE", "BENEFICIARY");
    const body = req.body ?? {};

    const campId = String(body.campId ?? "").trim();
    const beneficiaryId = String(body.beneficiaryId ?? "").trim();
    if (!campId) throw new ApiError("campId is required", 400);
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);

    const camp = await db.medicalCamp.findUnique({ where: { id: campId } });
    if (!camp) throw new ApiError("Camp not found", 404);
    if (!["SCHEDULED", "LIVE"].includes(camp.status))
      throw new ApiError(`Camp is ${camp.status} — registration requires SCHEDULED or LIVE`, 409);

    const beneficiary = await db.beneficiary.findUnique({ where: { id: beneficiaryId } });
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

    const duplicate = await db.campRegistration.findUnique({
      where: { campId_beneficiaryId: { campId, beneficiaryId } },
    });
    if (duplicate)
      throw new ApiError("Beneficiary is already registered for this camp", 409);

    // Capacity counts active registrations only (cancelled/rejected free a slot)
    const activeCount = await db.campRegistration.count({
      where: { campId, status: { notIn: BLOCKING_STATUSES } },
    });
    if (activeCount >= camp.capacity) throw new ApiError("Camp capacity reached", 409);

    const registeredVia = String(body.registeredVia ?? "DESK").trim().toUpperCase();
    if (!REGISTERED_VIA.includes(registeredVia)) throw new ApiError("Invalid registeredVia", 400);

    // Self-service: a BENEFICIARY session may only register their own record.
    if (session.role === "BENEFICIARY") {
      if (registeredVia !== "SELF")
        throw new ApiError("Beneficiaries may only self-register (registeredVia: SELF)", 403);
      const own = await db.beneficiary.findFirst({ where: { userId: session.userId } });
      if (!own) throw new ApiError("No beneficiary profile is linked to your account", 403);
      if (own.id !== beneficiaryId)
        throw new ApiError("You can only register yourself for a camp", 403);
    }

    let scheduledSlot: Date | null = null;
    if (body.scheduledSlot) {
      scheduledSlot = new Date(String(body.scheduledSlot));
      if (Number.isNaN(scheduledSlot.getTime()))
        throw new ApiError("scheduledSlot is not a valid date", 400);
    }

    const code = await nextCampRegCode();
    const registration = await db.campRegistration.create({
      data: {
        campId,
        beneficiaryId,
        code,
        status: "REGISTERED",
        registeredVia,
        scheduledSlot,
        notes: body.notes ? String(body.notes).trim() : null,
        registeredByName: session.name,
      },
      include: { beneficiary: { select: BENEFICIARY_SELECT } },
    });

    await logActivity(
      session.name,
      "CAMP_REGISTER",
      "CampRegistration",
      `${beneficiary.name} registered for ${camp.title} (${code})`,
      session.userId
    );
    return json(res, registration, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/camp-registrations/:id — ADMIN | VOLUNTEER
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const registration = await db.campRegistration.findUnique({
      where: { id },
      include: {
        beneficiary: {
          select: { id: true, code: true, name: true, phone: true, age: true, gender: true },
        },
        camp: { select: { id: true, code: true, title: true, status: true, venue: true, city: true } },
        attendance: true,
      },
    });
    if (!registration) throw new ApiError("Registration not found", 404);
    return json(res, registration);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/camp-registrations/:id (ADMIN | VOLUNTEER)
// {status: CONFIRMED|CANCELLED|REJECTED, scheduledSlot?, notes?}
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.campRegistration.findUnique({
      where: { id },
      include: { camp: { select: { code: true, title: true } } },
    });
    if (!existing) throw new ApiError("Registration not found", 404);

    const data: { status?: string; scheduledSlot?: Date | null; notes?: string | null } = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!SETTABLE_STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      assertTransition(TRANSITIONS, existing.status, status, "camp registration");
      data.status = status;
    }
    if (body.scheduledSlot !== undefined) {
      if (body.scheduledSlot === null || String(body.scheduledSlot).trim() === "") {
        data.scheduledSlot = null;
      } else {
        const slot = new Date(String(body.scheduledSlot));
        if (Number.isNaN(slot.getTime()))
          throw new ApiError("scheduledSlot is not a valid date", 400);
        data.scheduledSlot = slot;
      }
    }
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const registration = await db.campRegistration.update({
      where: { id },
      data,
      include: {
        beneficiary: {
          select: { id: true, code: true, name: true, phone: true, age: true, gender: true },
        },
      },
    });

    await logActivity(
      session.name,
      "CAMP_REGISTRATION_UPDATE",
      "CampRegistration",
      `${registration.code}${body.status !== undefined ? ` → ${registration.status}` : ""} (${existing.camp.title})`,
      session.userId
    );
    return json(res, registration);
  } catch (e) {
    return handleError(e, res);
  }
});
