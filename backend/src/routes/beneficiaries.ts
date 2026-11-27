/**
 * Beneficiary routes — /api/beneficiaries, /api/beneficiaries/:id, /api/beneficiaries/:id/notes
 * Converted 1:1 from src/app/api/beneficiaries/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { nextBeneficiaryCode } from "@/lib/codes";
import {
  CASE_STATUSES,
  CASE_STATUS_TRANSITIONS,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_TRANSITIONS,
  KYC_STATUSES,
  KYC_TRANSITIONS,
} from "@/lib/beneficiaries";
import { assertTransition } from "@/lib/workflow";

export const router = Router();

const log = logger.child("beneficiaries");

const CATEGORIES = [
  "WIDOW",
  "ORPHAN",
  "STUDENT",
  "ELDERLY",
  "DISABLED",
  "SINGLE_MOTHER",
  "POOR_FAMILY",
  "PATIENT",
  "DAILY_WAGE",
  "OTHER",
];
const URGENCY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// widened views for .includes(string) checks
const CASE_STATUSES_ALL: readonly string[] = CASE_STATUSES;
const VERIFICATION_STATUSES_ALL: readonly string[] = VERIFICATION_STATUSES;

// GET /api/beneficiaries?q=&category=&active=0/1 (staff) · ?mine=1 (self case)
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;

    if (sp.get("mine") === "1") {
      // A beneficiary sees only their own case record (no cross-enumeration)
      const s = await requireAuth(req);
      const mine = await db.beneficiary.findUnique({
        where: { userId: s.userId },
      });
      return json(res, mine ? [mine] : []);
    }

    await requireRole(req, "ADMIN", "VOLUNTEER", "DOCTOR", "NURSE");
    const q = sp.get("q")?.trim() || undefined;
    const category = sp.get("category") || undefined;
    const active = sp.get("active");

    const where: Prisma.BeneficiaryWhereInput = {};
    const caseStatus = sp.get("caseStatus");
    if (caseStatus) where.caseStatus = caseStatus.toUpperCase();
    const verification = sp.get("verificationStatus");
    if (verification) where.verificationStatus = verification.toUpperCase();
    if (q)
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
      ];
    if (category) where.category = category;
    if (active === "0" || active === "1") where.isActive = active === "1";

    const hasRecurring = sp.get("hasRecurringNeeds");
    if (hasRecurring === "1") where.recurringNeeds = { some: { status: "ACTIVE" } };
    else if (hasRecurring === "0") where.recurringNeeds = { none: { status: "ACTIVE" } };

    const findManyArgs = {
      where,
      orderBy: { createdAt: "desc" as const },
      include: { _count: { select: { recurringNeeds: { where: { status: "ACTIVE" } } } } },
    };

    // Optional pagination (gap A-8, backward-compatible): with no ?page/limit
    // the legacy unpaginated array shape is returned exactly as before.
    const pageRaw = sp.get("page");
    const limitRaw = sp.get("limit");
    if (pageRaw || limitRaw) {
      const page = Math.max(1, Math.trunc(Number(pageRaw) || 1));
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(limitRaw) || 20)));
      const [items, total] = await Promise.all([
        db.beneficiary.findMany({
          ...findManyArgs,
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.beneficiary.count({ where }),
      ]);
      return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
    }

    const rows = await db.beneficiary.findMany(findManyArgs);
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/beneficiaries (ADMIN | VOLUNTEER)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const body = req.body ?? {};

    const name = String(body.name ?? "").trim();
    const category = String(body.category ?? "").trim().toUpperCase() || "OTHER";
    const urgencyLevel =
      String(body.urgencyLevel ?? "").trim().toUpperCase() || "MEDIUM";
    if (!name) throw new ApiError("name is required", 400);
    if (!CATEGORIES.includes(category)) throw new ApiError("Invalid category", 400);
    if (!URGENCY.includes(urgencyLevel))
      throw new ApiError("Invalid urgencyLevel", 400);

    const familyMembers = Number.isFinite(Number(body.familyMembers))
      ? Math.max(1, Math.trunc(Number(body.familyMembers)))
      : 1;
    const state = body.state ? String(body.state).trim() : null;
    const pincodeRaw = body.pincode ? String(body.pincode).trim() : null;
    if (pincodeRaw && !/^[1-9][0-9]{5}$/.test(pincodeRaw))
      throw new ApiError("PIN code must be 6 digits", 400);
    const guardian = body.guardian ? String(body.guardian).trim() : null;
    let age: number | null = null;
    if (body.age !== undefined && body.age !== null && String(body.age).trim() !== "") {
      const a = Number(body.age);
      if (!Number.isFinite(a) || a < 0 || a > 120)
        throw new ApiError("Age must be between 0 and 120", 400);
      age = Math.round(a);
    }
    let gender: string | null = null;
    if (body.gender) {
      const g = String(body.gender).toUpperCase();
      if (!["MALE", "FEMALE", "OTHER"].includes(g))
        throw new ApiError("Invalid gender", 400);
      gender = g;
    }
    const monthlyNeed = Number.isFinite(Number(body.monthlyNeed))
      ? Math.max(0, Number(body.monthlyNeed)) || null
      : null;
    const documents = body.documents ? String(body.documents).trim() : null;
    const caseStatusRaw = body.caseStatus
      ? String(body.caseStatus).trim().toUpperCase()
      : "INTAKE";
    if (!["INTAKE", "VERIFICATION", "ACTIVE", "CLOSED", "REJECTED"].includes(caseStatusRaw))
      throw new ApiError("Invalid case status", 400);
    const verificationStatusRaw = body.verificationStatus
      ? String(body.verificationStatus).trim().toUpperCase()
      : "PENDING";
    if (!["PENDING", "DOCUMENTS_REQUESTED", "VERIFIED", "REJECTED"].includes(verificationStatusRaw))
      throw new ApiError("Invalid verification status", 400);
    const caseWorker = body.caseWorker ? String(body.caseWorker).trim() : null;
    const intakeDate = body.intakeDate ? new Date(String(body.intakeDate)) : null;

    const monthlyIncome =
      body.monthlyIncome !== undefined &&
      body.monthlyIncome !== null &&
      body.monthlyIncome !== "" &&
      Number.isFinite(Number(body.monthlyIncome))
        ? Number(body.monthlyIncome)
        : null;

    const beneficiary = await db.beneficiary.create({
      data: {
        code: await nextBeneficiaryCode(),
        name,
        phone: body.phone ? String(body.phone).trim() : null,
        city: body.city ? String(body.city).trim() : null,
        state,
        pincode: pincodeRaw,
        guardian,
        age,
        gender,
        monthlyNeed,
        documents,
        caseStatus: caseStatusRaw,
        verificationStatus: verificationStatusRaw,
        caseWorker,
        photoConsent: Boolean(body.photoConsent),
        intakeDate,
        category,
        urgencyLevel,
        familyMembers,
        monthlyIncome,
        needs: body.needs ? String(body.needs) : null,
        notes: body.notes ? String(body.notes) : null,
        address: body.address ? String(body.address) : null,
        onboardedByName: session.name,
      },
    });

    log.info("beneficiary_created", {
      beneficiaryId: beneficiary.id,
      code: beneficiary.code,
      category,
      urgencyLevel,
      caseStatus: beneficiary.caseStatus,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "BENEFICIARY_ADD",
      "Beneficiary",
      `${name} (${category})`,
      session.userId
    );
    return json(res, beneficiary, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/beneficiaries/:id (ADMIN | VOLUNTEER)
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.beneficiary.findUnique({ where: { id } });
    if (!existing) {
      log.warn("beneficiary_update_not_found", { beneficiaryId: id, actor: session.userId });
      throw new ApiError("Beneficiary not found", 404);
    }

    const data: Prisma.BeneficiaryUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.phone !== undefined)
      data.phone = body.phone ? String(body.phone).trim() : null;
    if (body.email !== undefined)
      data.email = body.email ? String(body.email).trim() : null;
    if (body.city !== undefined)
      data.city = body.city ? String(body.city).trim() : null;
    if (body.address !== undefined)
      data.address = body.address ? String(body.address) : null;
    if (body.category !== undefined)
      data.category = String(body.category).trim().toUpperCase();
    if (body.urgencyLevel !== undefined)
      data.urgencyLevel = String(body.urgencyLevel).trim().toUpperCase();
    if (body.familyMembers !== undefined)
      data.familyMembers = Math.max(1, Math.trunc(Number(body.familyMembers)) || 1);
    if (body.monthlyIncome !== undefined)
      data.monthlyIncome =
        body.monthlyIncome === null || body.monthlyIncome === ""
          ? null
          : Number(body.monthlyIncome);
    if (body.needs !== undefined)
      data.needs = body.needs ? String(body.needs) : null;
    if (body.notes !== undefined)
      data.notes = body.notes ? String(body.notes) : null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    // Case workflow — previously these fields were silently dropped by this
    // handler, so the admin case actions never persisted; they are now applied
    // and guarded by the transition machines.
    if (body.caseStatus !== undefined) {
      const caseStatus = String(body.caseStatus).trim().toUpperCase();
      if (!CASE_STATUSES_ALL.includes(caseStatus))
        throw new ApiError("Invalid case status", 400);
      if (caseStatus !== (existing.caseStatus ?? "INTAKE") && !CASE_STATUS_TRANSITIONS[existing.caseStatus ?? "INTAKE"]?.includes(caseStatus))
        log.warn("beneficiary_invalid_case_transition", {
          beneficiaryId: id,
          from: existing.caseStatus,
          to: caseStatus,
          actor: session.userId,
        });
      assertTransition(
        CASE_STATUS_TRANSITIONS,
        existing.caseStatus ?? "INTAKE",
        caseStatus,
        "beneficiary caseStatus",
        400
      );
      data.caseStatus = caseStatus;
      if (caseStatus === "ACTIVE" && !existing.intakeDate)
        data.intakeDate = new Date();
    }
    if (body.verificationStatus !== undefined) {
      const verificationStatus = String(body.verificationStatus).trim().toUpperCase();
      if (!VERIFICATION_STATUSES_ALL.includes(verificationStatus))
        throw new ApiError("Invalid verification status", 400);
      if (verificationStatus !== (existing.verificationStatus ?? "PENDING") && !VERIFICATION_STATUS_TRANSITIONS[existing.verificationStatus ?? "PENDING"]?.includes(verificationStatus))
        log.warn("beneficiary_invalid_verification_transition", {
          beneficiaryId: id,
          from: existing.verificationStatus,
          to: verificationStatus,
          actor: session.userId,
        });
      assertTransition(
        VERIFICATION_STATUS_TRANSITIONS,
        existing.verificationStatus ?? "PENDING",
        verificationStatus,
        "beneficiary verificationStatus",
        400
      );
      data.verificationStatus = verificationStatus;
    }

    const beneficiary = await db.beneficiary.update({ where: { id }, data });
    log.info("beneficiary_updated", {
      beneficiaryId: id,
      code: beneficiary.code,
      fields: Object.keys(data),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "BENEFICIARY_UPDATE",
      "Beneficiary",
      beneficiary.name,
      session.userId
    );
    return json(res, beneficiary);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/beneficiaries/:id (ADMIN)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.beneficiary.findUnique({ where: { id } });
    if (!existing) {
      log.warn("beneficiary_delete_not_found", { beneficiaryId: id, actor: session.userId });
      throw new ApiError("Beneficiary not found", 404);
    }

    await db.beneficiary.delete({ where: { id } });
    log.info("beneficiary_deleted", {
      beneficiaryId: id,
      caseStatus: existing.caseStatus,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "BENEFICIARY_DELETE",
      "Beneficiary",
      existing.name,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── KYC verification workflow (gap A-4) ──────────────────────────────

const KYC_STATUSES_ALL: readonly string[] = KYC_STATUSES;
const MAX_KYC_DOCS = 10;

/** Owner or admin — a beneficiary manages only their own KYC submission. */
async function requireKycOwner(req: import("express").Request, beneficiaryId: string) {
  const session = await requireAuth(req);
  const beneficiary = await db.beneficiary.findUnique({ where: { id: beneficiaryId } });
  if (!beneficiary) {
    log.warn("beneficiary_kyc_beneficiary_not_found", {
      beneficiaryId,
      actor: session.userId,
    });
    throw new ApiError("Beneficiary not found", 404);
  }
  if (session.role !== "ADMIN" && beneficiary.userId !== session.userId) {
    log.warn("beneficiary_kyc_forbidden", {
      beneficiaryId,
      actor: session.userId,
    });
    throw new ApiError("You do not have permission for this action", 403);
  }
  return { session, beneficiary };
}

// POST /api/beneficiaries/:id/kyc — the owning BENEFICIARY (or ADMIN) submits
// KYC documents: `documentIds` is an array of /api/files upload ids (uploaded
// by this user — non-admin uploads land in their `kyc/<userId>` folder).
// Moves kycStatus → SUBMITTED; admins then approve/reject via /kyc/review.
router.post("/:id/kyc", async (req, res) => {
  try {
    const { id } = req.params;
    const { session, beneficiary } = await requireKycOwner(req, id);
    const body = req.body ?? {};

    let ids: string[];
    try {
      const parsed = typeof body?.documentIds === "string" ? JSON.parse(body.documentIds) : body?.documentIds;
      if (!Array.isArray(parsed)) throw new Error("not an array");
      ids = parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
    } catch {
      throw new ApiError("documentIds must be an array of /api/files ids", 400);
    }
    if (ids.length === 0)
      throw new ApiError("Attach at least one KYC document", 400);
    if (ids.length > MAX_KYC_DOCS)
      throw new ApiError(`At most ${MAX_KYC_DOCS} documents can be attached`, 400);
    if (new Set(ids).size !== ids.length)
      throw new ApiError("documentIds contains duplicates", 400);

    // Every id must be a real file asset (any mime — admins judge suitability).
    const found = await db.fileAsset.findMany({
      where: { id: { in: ids } },
      select: { id: true, uploadedById: true, mime: true },
    });
    if (found.length !== ids.length)
      throw new ApiError("One or more documents were not found", 400);
    // KYC documents must be viewable by reviewers: document mimes are
    // auth-gated with admin/uploader access, so any file this user uploaded
    // (or any admin-uploaded file) is reviewable. An ADMIN submitter passes
    // trivially.
    if (session.role !== "ADMIN") {
      for (const f of found) {
        if (f.uploadedById !== session.userId) {
          log.warn("beneficiary_kyc_foreign_files", {
            beneficiaryId: id,
            actor: session.userId,
          });
          throw new ApiError("KYC documents must be files uploaded by you", 403);
        }
      }
    }

    if (beneficiary.kycStatus !== "SUBMITTED" && !KYC_TRANSITIONS[beneficiary.kycStatus]?.includes("SUBMITTED"))
      log.warn("beneficiary_kyc_invalid_transition", {
        beneficiaryId: id,
        from: beneficiary.kycStatus,
        to: "SUBMITTED",
        actor: session.userId,
      });
    assertTransition(KYC_TRANSITIONS, beneficiary.kycStatus, "SUBMITTED", "beneficiary kycStatus", 400);

    const updated = await db.beneficiary.update({
      where: { id },
      data: {
        kycStatus: "SUBMITTED",
        kycDocuments: JSON.stringify(ids),
      },
    });

    log.info("beneficiary_kyc_submitted", {
      beneficiaryId: id,
      documentCount: ids.length,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "BENEFICIARY_KYC_SUBMIT",
      "Beneficiary",
      `${beneficiary.name}: ${ids.length} document(s)`,
      session.userId
    );
    return json(res, updated, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/beneficiaries/:id/kyc/review (ADMIN) — approve/reject a KYC
// submission: { status: "VERIFIED" | "REJECTED", notes? }.
router.post("/:id/kyc/review", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const status = String(body?.status ?? "").trim().toUpperCase();
    if (!status) throw new ApiError("status must be VERIFIED or REJECTED", 400);
    if (!KYC_STATUSES_ALL.includes(status) || status === "PENDING" || status === "SUBMITTED")
      throw new ApiError("status must be VERIFIED or REJECTED", 400);

    const beneficiary = await db.beneficiary.findUnique({ where: { id } });
    if (!beneficiary) {
      log.warn("beneficiary_kyc_review_not_found", { beneficiaryId: id, actor: session.userId });
      throw new ApiError("Beneficiary not found", 404);
    }
    if (beneficiary.kycStatus !== "SUBMITTED") {
      log.warn("beneficiary_kyc_review_blocked_status", {
        beneficiaryId: id,
        kycStatus: beneficiary.kycStatus,
        actor: session.userId,
      });
      throw new ApiError(`Only SUBMITTED KYC can be reviewed (current: ${beneficiary.kycStatus})`, 400);
    }

    const updated = await db.beneficiary.update({
      where: { id },
      data: {
        kycStatus: status,
        kycNotes: body?.notes ? String(body.notes) : null,
        kycReviewedAt: new Date(),
        kycReviewedBy: session.name,
      },
    });

    log.info("beneficiary_kyc_reviewed", {
      beneficiaryId: id,
      kycStatus: status,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      `BENEFICIARY_KYC_${status}`,
      "Beneficiary",
      beneficiary.name,
      session.userId
    );
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/beneficiaries/:id/notes — case-note timeline
router.get("/:id/notes", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const notes = await db.beneficiaryNote.findMany({
      where: { beneficiaryId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return json(res, notes);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/beneficiaries/:id/notes — add a case note
router.post("/:id/notes", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = req.body ?? {};

    const note = String(body?.note ?? "").trim();
    if (!note) throw new ApiError("Note cannot be empty", 400);

    const beneficiary = await db.beneficiary.findUnique({ where: { id } });
    if (!beneficiary) {
      log.warn("beneficiary_note_beneficiary_not_found", {
        beneficiaryId: id,
        actor: session.userId,
      });
      throw new ApiError("Beneficiary not found", 404);
    }

    const row = await db.beneficiaryNote.create({
      data: {
        beneficiaryId: id,
        authorName: session.name,
        note,
      },
    });
    log.info("beneficiary_note_added", {
      noteId: row.id,
      beneficiaryId: id,
      actor: session.userId,
    });
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});
