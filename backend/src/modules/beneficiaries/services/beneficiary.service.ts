/**
 * Beneficiary service — case record rules: staff/self listing, onboarding
 * coercion, case + verification status workflow transitions and the KYC
 * submission/review flow.
 *
 * The legacy handlers validated body fields mid-handler after the
 * auth/ownership gates (with the beneficiary lookup interleaved —
 * 404-before-400 ordering), so those checks and their exact messages live
 * here instead of in route-level Zod schemas.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
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
import type {
  BeneficiaryCreateData,
  BeneficiaryListFilters,
  BeneficiaryNoteRow,
  BeneficiaryRepository,
  BeneficiaryRow,
  BeneficiaryUpdateData,
} from "../repositories/beneficiary.repository.interface";
import type {
  CreateBeneficiaryBody,
  CreateNoteBody,
  ListBeneficiariesQuery,
  ReviewKycBody,
  SubmitKycBody,
  UpdateBeneficiaryBody,
} from "../schemas/beneficiary.schema";

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
const KYC_STATUSES_ALL: readonly string[] = KYC_STATUSES;
const MAX_KYC_DOCS = 10;

export class BeneficiaryService {
  constructor(private readonly beneficiaryRepository: BeneficiaryRepository) {}

  /**
   * GET /api/beneficiaries (staff branch) — optional pagination: with no
   * ?page/limit the legacy unpaginated array shape is returned exactly as
   * before.
   */
  async list(query: ListBeneficiariesQuery): Promise<unknown> {
    const filters: BeneficiaryListFilters = {
      q: query.q,
      category: query.category,
      active: query.active,
      caseStatus: query.caseStatus,
      verificationStatus: query.verificationStatus,
      hasRecurringNeeds: query.hasRecurringNeeds,
    };

    const pageRaw = query.page;
    const limitRaw = query.limit;
    if (pageRaw || limitRaw) {
      const page = Math.max(1, Math.trunc(Number(pageRaw) || 1));
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(limitRaw) || 20)));
      const { rows, total } = await this.beneficiaryRepository.listBeneficiariesPaged(
        filters,
        (page - 1) * limit,
        limit
      );
      return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
    }

    return this.beneficiaryRepository.listBeneficiaries(filters);
  }

  /** GET /api/beneficiaries?mine=1 — a beneficiary sees only their own case
   *  record (no cross-enumeration). */
  async listMine(userId: string): Promise<BeneficiaryRow[]> {
    const mine = await this.beneficiaryRepository.findBeneficiaryByUserId(userId);
    return mine ? [mine] : [];
  }

  /** POST /api/beneficiaries (ADMIN | VOLUNTEER). */
  async create(body: CreateBeneficiaryBody, actor: Session): Promise<BeneficiaryRow> {
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

    const data: BeneficiaryCreateData = {
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
      onboardedByName: actor.name,
    };

    const beneficiary = await this.beneficiaryRepository.createBeneficiary(data);

    log.info("beneficiary_created", {
      beneficiaryId: beneficiary.id,
      code: beneficiary.code,
      category,
      urgencyLevel,
      caseStatus: beneficiary.caseStatus,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "BENEFICIARY_ADD",
      "Beneficiary",
      `${name} (${category})`,
      actor.userId
    );
    return beneficiary;
  }

  /**
   * PATCH /api/beneficiaries/:id (ADMIN | VOLUNTEER) — plain fields plus the
   * guarded case/verification workflow transitions. The 404 fires BEFORE body
   * processing (legacy order).
   */
  async update(id: string, body: UpdateBeneficiaryBody, actor: Session): Promise<BeneficiaryRow> {
    const existing = await this.beneficiaryRepository.findBeneficiaryById(id);
    if (!existing) {
      log.warn("beneficiary_update_not_found", { beneficiaryId: id, actor: actor.userId });
      throw new ApiError("Beneficiary not found", 404);
    }

    const data: BeneficiaryUpdateData = {};
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
          actor: actor.userId,
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
          actor: actor.userId,
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

    const beneficiary = await this.beneficiaryRepository.updateBeneficiary(id, data);
    log.info("beneficiary_updated", {
      beneficiaryId: id,
      code: beneficiary.code,
      fields: Object.keys(data),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "BENEFICIARY_UPDATE",
      "Beneficiary",
      beneficiary.name,
      actor.userId
    );
    return beneficiary;
  }

  /** DELETE /api/beneficiaries/:id (ADMIN). */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.beneficiaryRepository.findBeneficiaryById(id);
    if (!existing) {
      log.warn("beneficiary_delete_not_found", { beneficiaryId: id, actor: actor.userId });
      throw new ApiError("Beneficiary not found", 404);
    }

    await this.beneficiaryRepository.deleteBeneficiary(id);
    log.info("beneficiary_deleted", {
      beneficiaryId: id,
      caseStatus: existing.caseStatus,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "BENEFICIARY_DELETE",
      "Beneficiary",
      existing.name,
      actor.userId
    );
    return { ok: true };
  }

  /**
   * POST /api/beneficiaries/:id/kyc — the owning BENEFICIARY (or ADMIN)
   * submits KYC documents: `documentIds` is an array of /api/files upload ids
   * (uploaded by this user — non-admin uploads land in their `kyc/<userId>`
   * folder). Moves kycStatus → SUBMITTED; admins then approve/reject via
   * the review endpoint.
   */
  async submitKyc(id: string, body: SubmitKycBody, actor: Session): Promise<BeneficiaryRow> {
    const beneficiary = await this.beneficiaryRepository.findBeneficiaryById(id);
    if (!beneficiary) {
      log.warn("beneficiary_kyc_beneficiary_not_found", {
        beneficiaryId: id,
        actor: actor.userId,
      });
      throw new ApiError("Beneficiary not found", 404);
    }
    if (actor.role !== "ADMIN" && beneficiary.userId !== actor.userId) {
      log.warn("beneficiary_kyc_forbidden", {
        beneficiaryId: id,
        actor: actor.userId,
      });
      throw new ApiError("You do not have permission for this action", 403);
    }

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
    const found = await this.beneficiaryRepository.findFileAssetsByIds(ids);
    if (found.length !== ids.length)
      throw new ApiError("One or more documents were not found", 400);
    // KYC documents must be viewable by reviewers: document mimes are
    // auth-gated with admin/uploader access, so any file this user uploaded
    // (or any admin-uploaded file) is reviewable. An ADMIN submitter passes
    // trivially.
    if (actor.role !== "ADMIN") {
      for (const f of found) {
        if (f.uploadedById !== actor.userId) {
          log.warn("beneficiary_kyc_foreign_files", {
            beneficiaryId: id,
            actor: actor.userId,
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
        actor: actor.userId,
      });
    assertTransition(KYC_TRANSITIONS, beneficiary.kycStatus, "SUBMITTED", "beneficiary kycStatus", 400);

    const updated = await this.beneficiaryRepository.updateBeneficiary(id, {
      kycStatus: "SUBMITTED",
      kycDocuments: JSON.stringify(ids),
    });

    log.info("beneficiary_kyc_submitted", {
      beneficiaryId: id,
      documentCount: ids.length,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "BENEFICIARY_KYC_SUBMIT",
      "Beneficiary",
      `${beneficiary.name}: ${ids.length} document(s)`,
      actor.userId
    );
    return updated;
  }

  /** POST /api/beneficiaries/:id/kyc/review (ADMIN) — approve/reject a KYC
   *  submission: { status: "VERIFIED" | "REJECTED", notes? }. */
  async reviewKyc(id: string, body: ReviewKycBody, actor: Session): Promise<BeneficiaryRow> {
    const status = String(body?.status ?? "").trim().toUpperCase();
    if (!status) throw new ApiError("status must be VERIFIED or REJECTED", 400);
    if (!KYC_STATUSES_ALL.includes(status) || status === "PENDING" || status === "SUBMITTED")
      throw new ApiError("status must be VERIFIED or REJECTED", 400);

    const beneficiary = await this.beneficiaryRepository.findBeneficiaryById(id);
    if (!beneficiary) {
      log.warn("beneficiary_kyc_review_not_found", { beneficiaryId: id, actor: actor.userId });
      throw new ApiError("Beneficiary not found", 404);
    }
    if (beneficiary.kycStatus !== "SUBMITTED") {
      log.warn("beneficiary_kyc_review_blocked_status", {
        beneficiaryId: id,
        kycStatus: beneficiary.kycStatus,
        actor: actor.userId,
      });
      throw new ApiError(`Only SUBMITTED KYC can be reviewed (current: ${beneficiary.kycStatus})`, 400);
    }

    const updated = await this.beneficiaryRepository.updateBeneficiary(id, {
      kycStatus: status,
      kycNotes: body?.notes ? String(body.notes) : null,
      kycReviewedAt: new Date(),
      kycReviewedBy: actor.name,
    });

    log.info("beneficiary_kyc_reviewed", {
      beneficiaryId: id,
      kycStatus: status,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      `BENEFICIARY_KYC_${status}`,
      "Beneficiary",
      beneficiary.name,
      actor.userId
    );
    return updated;
  }

  /** GET /api/beneficiaries/:id/notes — case-note timeline. */
  async listNotes(id: string): Promise<BeneficiaryNoteRow[]> {
    return this.beneficiaryRepository.listNotes(id);
  }

  /** POST /api/beneficiaries/:id/notes — add a case note. */
  async addNote(id: string, body: CreateNoteBody, actor: Session): Promise<BeneficiaryNoteRow> {
    const note = String(body?.note ?? "").trim();
    if (!note) throw new ApiError("Note cannot be empty", 400);

    const beneficiary = await this.beneficiaryRepository.findBeneficiaryById(id);
    if (!beneficiary) {
      log.warn("beneficiary_note_beneficiary_not_found", {
        beneficiaryId: id,
        actor: actor.userId,
      });
      throw new ApiError("Beneficiary not found", 404);
    }

    const row = await this.beneficiaryRepository.createNote({
      beneficiaryId: id,
      authorName: actor.name,
      note,
    });
    log.info("beneficiary_note_added", {
      noteId: row.id,
      beneficiaryId: id,
      actor: actor.userId,
    });
    return row;
  }
}
