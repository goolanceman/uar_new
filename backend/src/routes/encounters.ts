/**
 * Encounter routes — /api/encounters, /api/encounters/:id, /api/encounters/:id/sign
 * Converted 1:1 from src/app/api/encounters/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const router = Router();

const ENCOUNTER_INCLUDE = {
  beneficiary: {
    select: { id: true, code: true, name: true, age: true, gender: true, phone: true },
  },
  doctor: {
    select: { id: true, name: true, regNumber: true, speciality: true, kind: true },
  },
  camp: { select: { id: true, code: true, title: true, venue: true, city: true, campDate: true } },
} as const;

// Detail include used by GET/PATCH /:id — adds bloodGroup + allergies to the
// beneficiary projection (as in the original [id] route handler).
const ENCOUNTER_INCLUDE_DETAIL = {
  beneficiary: {
    select: {
      id: true, code: true, name: true, age: true, gender: true, phone: true,
      bloodGroup: true, allergies: true,
    },
  },
  doctor: {
    select: { id: true, name: true, regNumber: true, speciality: true, kind: true },
  },
  camp: { select: { id: true, code: true, title: true, venue: true, city: true, campDate: true } },
} as const;

const ENCOUNTER_SIGN_INCLUDE = {
  beneficiary: {
    select: { id: true, code: true, name: true, age: true, gender: true },
  },
  doctor: {
    select: { id: true, name: true, regNumber: true, speciality: true, kind: true },
  },
  camp: { select: { id: true, code: true, title: true, venue: true, city: true, campDate: true } },
} as const;

const VALID_STATUSES = ["DRAFT", "SIGNED"];

function pageParams(url: URL, defLimit = 50) {
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || defLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function optDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The amendments JSON column keeps the full retained history of signed-record corrections. */
function parseAmendments(raw: string | null): { at: string; byName: string; note: string }[] {
  try {
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// GET /api/encounters — staff list (newest first)
// Roles: ADMIN | DOCTOR | NURSE. Filters: beneficiaryId, campId, doctorId,
// status, from/to (createdAt range). Envelope { items, total, page, pages }.
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "DOCTOR", "NURSE");
    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    const beneficiaryId = url.searchParams.get("beneficiaryId");
    const campId = url.searchParams.get("campId");
    const doctorId = url.searchParams.get("doctorId");
    const status = url.searchParams.get("status");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (beneficiaryId) where.beneficiaryId = beneficiaryId;
    if (campId) where.campId = campId;
    if (doctorId) where.doctorId = doctorId;
    if (status) {
      if (!VALID_STATUSES.includes(status))
        throw new ApiError("status must be DRAFT or SIGNED", 400);
      where.status = status;
    }
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      const fromDate = optDate(from);
      const toDate = optDate(to);
      if (from && !fromDate) throw new ApiError("Invalid from date", 400);
      if (to && !toDate) throw new ApiError("Invalid to date", 400);
      if (fromDate) createdAt.gte = fromDate;
      // date-only "to" values cover the whole end day
      if (toDate && String(to).length <= 10)
        createdAt.lte = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
      else if (toDate) createdAt.lte = toDate;
      where.createdAt = createdAt;
    }

    const [total, items] = await Promise.all([
      db.encounter.count({ where }),
      db.encounter.findMany({
        where,
        include: ENCOUNTER_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/encounters — DOCTOR only. doctorId is resolved from the caller's
// HealthProfessional row (linked by userId). New encounters start as DRAFT.
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "DOCTOR");
    const body = req.body ?? {};

    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await db.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true, code: true, name: true },
    });
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

    const campId = String(body?.campId ?? "").trim() || null;
    if (campId) {
      const camp = await db.medicalCamp.findUnique({ where: { id: campId }, select: { id: true } });
      if (!camp) throw new ApiError("Camp not found", 404);
    }

    const professional = await db.healthProfessional.findUnique({
      where: { userId: session.userId },
      select: { id: true, name: true, kind: true },
    });
    if (!professional)
      throw new ApiError(
        "No health-professional profile is linked to your account — ask an admin to create a DOCTOR profile for you",
        403
      );

    const encounter = await db.encounter.create({
      data: {
        campId,
        registrationId: optText(body?.registrationId),
        beneficiaryId,
        doctorId: professional.id,
        status: "DRAFT",
        chiefComplaint: optText(body?.chiefComplaint),
        observations: optText(body?.observations),
        diagnosis: optText(body?.diagnosis),
        advice: optText(body?.advice),
        followUpDate: optDate(body?.followUpDate),
      },
      include: ENCOUNTER_INCLUDE,
    });

    await logActivity(
      session.name,
      "ENCOUNTER_CREATE",
      "ENCOUNTER",
      `Encounter for ${beneficiary.code} (${beneficiary.name}) by ${professional.name}`,
      session.userId
    );

    return json(res, encounter, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/encounters/:id — ADMIN | DOCTOR | NURSE, plus the BENEFICIARY
// account linked to the patient record itself.
router.get("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR", "NURSE", "BENEFICIARY");
    const { id } = req.params;

    const encounter = await db.encounter.findUnique({
      where: { id },
      include: {
        ...ENCOUNTER_INCLUDE_DETAIL,
        vitals: { orderBy: { recordedAt: "desc" } },
        screenings: { orderBy: { recordedAt: "desc" } },
        prescriptions: {
          select: { id: true, code: true, status: true, createdAt: true, diagnosis: true },
        },
        labOrders: {
          select: { id: true, code: true, testName: true, status: true, critical: true, createdAt: true },
        },
        referrals: {
          select: { id: true, code: true, status: true, priority: true, reason: true, createdAt: true },
        },
      },
    });
    if (!encounter) throw new ApiError("Encounter not found", 404);

    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({
        where: { userId: session.userId },
        select: { id: true },
      });
      if (!own || own.id !== encounter.beneficiaryId)
        throw new ApiError("You do not have permission for this action", 403);
    }

    return json(res, { ...encounter, amendments: parseAmendments(encounter.amendments) });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/encounters/:id
// - DRAFT: the owning DOCTOR (or ADMIN) edits chiefComplaint / observations /
//   diagnosis / advice / followUpDate.
// - SIGNED: immutable by design — the owning DOCTOR (or ADMIN) may send
//   { amendment: "..." } (alias: amendmentNote) together with updated fields.
//   The note is APPENDED to the amendments JSON history
//   [{ at, byName, note }] and the fields are updated; the original content
//   survives in the amendments history.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.encounter.findUnique({
      where: { id },
      include: { doctor: { select: { id: true, userId: true, name: true } } },
    });
    if (!existing) throw new ApiError("Encounter not found", 404);

    const isOwner = session.role === "DOCTOR" && existing.doctor.userId === session.userId;
    const isAdmin = session.role === "ADMIN";

    if (body?.status !== undefined && String(body.status) !== existing.status)
      throw new ApiError(
        existing.status === "DRAFT"
          ? "Use POST /api/encounters/:id/sign to sign an encounter"
          : "Encounter status cannot be changed via PATCH",
        400
      );

    const data: Record<string, unknown> = {};
    if (body?.chiefComplaint !== undefined) data.chiefComplaint = optText(body.chiefComplaint);
    if (body?.observations !== undefined) data.observations = optText(body.observations);
    if (body?.diagnosis !== undefined) data.diagnosis = optText(body.diagnosis);
    if (body?.advice !== undefined) data.advice = optText(body.advice);
    if (body?.followUpDate !== undefined) data.followUpDate = optDate(body.followUpDate);

    if (existing.status === "DRAFT") {
      if (!isOwner && !isAdmin)
        throw new ApiError("Only the owning doctor can edit this draft encounter", 403);
      if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);
    } else {
      // SIGNED — amendment path only.
      const note = body?.amendment ?? body?.amendmentNote;
      if (note === undefined || String(note).trim() === "")
        throw new ApiError(
          'Signed encounters are immutable — send { amendment: "why + what changed" } with the corrected fields to record an amendment',
          409
        );
      if (!isOwner && !isAdmin)
        throw new ApiError("Only the owning doctor (or an admin) can amend this encounter", 403);

      const history = parseAmendments(existing.amendments);
      history.push({
        at: new Date().toISOString(),
        byName: session.name,
        note: String(note).trim(),
      });
      data.amendments = JSON.stringify(history);
    }

    const encounter = await db.encounter.update({
      where: { id },
      data,
      include: ENCOUNTER_INCLUDE_DETAIL,
    });

    await logActivity(
      session.name,
      existing.status === "SIGNED" ? "ENCOUNTER_AMEND" : "ENCOUNTER_UPDATE",
      "ENCOUNTER",
      `${encounter.id} — fields: ${Object.keys(data).filter((k) => k !== "amendments").join(", ") || "note only"}`,
      session.userId
    );

    return json(res, { ...encounter, amendments: parseAmendments(encounter.amendments) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/encounters/:id/sign — the owning DOCTOR (or ADMIN) signs the
// encounter. Signed encounters are immutable; further corrections go through
// PATCH with { amendment }.
router.post("/:id/sign", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR");
    const { id } = req.params;

    const existing = await db.encounter.findUnique({
      where: { id },
      include: { doctor: { select: { userId: true, name: true } } },
    });
    if (!existing) throw new ApiError("Encounter not found", 404);

    const isOwner = session.role === "DOCTOR" && existing.doctor.userId === session.userId;
    if (!isOwner && session.role !== "ADMIN")
      throw new ApiError("Only the owning doctor can sign this encounter", 403);

    if (existing.status === "SIGNED")
      throw new ApiError("Encounter is already signed", 409);

    if (!existing.diagnosis?.trim() && !existing.observations?.trim())
      throw new ApiError("Add a diagnosis or observations before signing", 400);

    const encounter = await db.encounter.update({
      where: { id },
      data: {
        status: "SIGNED",
        signedAt: new Date(),
        signedByName: session.name,
      },
      include: ENCOUNTER_SIGN_INCLUDE,
    });

    await logActivity(
      session.name,
      "ENCOUNTER_SIGN",
      "ENCOUNTER",
      `Encounter signed for ${encounter.beneficiary.code} by ${session.name}`,
      session.userId
    );

    return json(res, encounter);
  } catch (e) {
    return handleError(e, res);
  }
});
