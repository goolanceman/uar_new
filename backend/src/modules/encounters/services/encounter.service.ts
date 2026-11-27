/**
 * Encounter service — clinical encounter rules: draft editing restricted to
 * the owning doctor (or admin), immutable signed records with an append-only
 * amendments history, and the sign gate. Depends on the repository contract,
 * throws application errors, never touches HTTP. Field checks keep the
 * legacy order exactly and every log event keeps its legacy name.
 */
import { logger } from "@/lib/logger";
import { logActivity, type Session } from "@/lib/session";
import { ApiError, NotFoundError } from "@/shared/errors";
import type {
  EncounterCreateData,
  EncounterDetailRow,
  EncounterFullDetailRow,
  EncounterListFilter,
  EncounterListRow,
  EncounterRepository,
  EncounterSignRow,
} from "../repositories/encounter.repository.interface";
import type {
  CreateEncounterBody,
  ListEncountersQuery,
  UpdateEncounterBody,
} from "../schemas/encounter.schema";

const log = logger.child("encounters");

const VALID_STATUSES = ["DRAFT", "SIGNED"];

export interface EncounterListEnvelope {
  items: EncounterListRow[];
  total: number;
  page: number;
  pages: number;
}

/** GET/PATCH /:id response — the detail row with the amendments JSON parsed. */
export type EncounterDetailWithAmendments = Omit<EncounterFullDetailRow, "amendments"> & {
  amendments: ReturnType<typeof parseAmendments>;
};

/** The amendments JSON column keeps the full retained history of signed-record corrections. */
function parseAmendments(raw: string | null): { at: string; byName: string; note: string }[] {
  try {
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
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

export class EncounterService {
  constructor(private readonly encounterRepository: EncounterRepository) {}

  /**
   * GET /api/encounters — staff list (newest first)
   * Roles: ADMIN | DOCTOR | NURSE. Filters: beneficiaryId, campId, doctorId,
   * status, from/to (createdAt range). Envelope { items, total, page, pages }.
   */
  async list(query: ListEncountersQuery): Promise<EncounterListEnvelope> {
    const where: EncounterListFilter = {};
    if (query.beneficiaryId) where.beneficiaryId = query.beneficiaryId;
    if (query.campId) where.campId = query.campId;
    if (query.doctorId) where.doctorId = query.doctorId;
    if (query.status) {
      if (!VALID_STATUSES.includes(query.status))
        throw new ApiError("status must be DRAFT or SIGNED", 400);
      where.status = query.status;
    }
    if (query.from || query.to) {
      const createdAt: { gte?: Date; lte?: Date } = {};
      const fromDate = optDate(query.from);
      const toDate = optDate(query.to);
      if (query.from && !fromDate) throw new ApiError("Invalid from date", 400);
      if (query.to && !toDate) throw new ApiError("Invalid to date", 400);
      if (fromDate) createdAt.gte = fromDate;
      // date-only "to" values cover the whole end day
      if (toDate && String(query.to).length <= 10)
        createdAt.lte = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
      else if (toDate) createdAt.lte = toDate;
      where.createdAt = createdAt;
    }

    const { items, total } = await this.encounterRepository.list(
      where,
      (query.page - 1) * query.limit,
      query.limit
    );

    return { items, total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)) };
  }

  /**
   * POST /api/encounters — DOCTOR only. doctorId is resolved from the caller's
   * HealthProfessional row (linked by userId). New encounters start as DRAFT.
   */
  async create(body: CreateEncounterBody, session: Session): Promise<EncounterListRow> {
    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await this.encounterRepository.findBeneficiaryLite(beneficiaryId);
    if (!beneficiary) {
      log.warn("encounter_beneficiary_not_found", {
        beneficiaryId,
        actor: session.userId,
      });
      throw new NotFoundError("Beneficiary not found");
    }

    const campId = String(body?.campId ?? "").trim() || null;
    if (campId) {
      const camp = await this.encounterRepository.findCampLite(campId);
      if (!camp) {
        log.warn("encounter_camp_not_found", { campId, actor: session.userId });
        throw new NotFoundError("Camp not found");
      }
    }

    const professional = await this.encounterRepository.findProfessionalByUserId(session.userId);
    if (!professional) {
      log.warn("encounter_no_professional_profile", { actor: session.userId });
      throw new ApiError(
        "No health-professional profile is linked to your account — ask an admin to create a DOCTOR profile for you",
        403
      );
    }

    const data: EncounterCreateData = {
      campId,
      registrationId: optText(body?.registrationId),
      beneficiaryId,
      doctorId: professional.id,
      chiefComplaint: optText(body?.chiefComplaint),
      observations: optText(body?.observations),
      diagnosis: optText(body?.diagnosis),
      advice: optText(body?.advice),
      followUpDate: optDate(body?.followUpDate),
    };
    const encounter = await this.encounterRepository.create(data);

    log.info("encounter_created", {
      encounterId: encounter.id,
      beneficiaryId,
      ...(campId ? { campId } : {}),
      doctorId: professional.id,
      status: encounter.status,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "ENCOUNTER_CREATE",
      "ENCOUNTER",
      `Encounter for ${beneficiary.code} (${beneficiary.name}) by ${professional.name}`,
      session.userId
    );

    return encounter;
  }

  /**
   * GET /api/encounters/:id — ADMIN | DOCTOR | NURSE, plus the BENEFICIARY
   * account linked to the patient record itself.
   */
  async get(id: string, session: Session): Promise<EncounterDetailWithAmendments> {
    const encounter = await this.encounterRepository.findDetailById(id);
    if (!encounter) throw new NotFoundError("Encounter not found");

    if (session.role === "BENEFICIARY") {
      const own = await this.encounterRepository.findBeneficiaryIdByUserId(session.userId);
      if (!own || own.id !== encounter.beneficiaryId)
        throw new ApiError("You do not have permission for this action", 403);
    }

    return { ...encounter, amendments: parseAmendments(encounter.amendments) } as EncounterDetailWithAmendments;
  }

  /**
   * PATCH /api/encounters/:id
   * - DRAFT: the owning DOCTOR (or ADMIN) edits chiefComplaint / observations /
   *   diagnosis / advice / followUpDate.
   * - SIGNED: immutable by design — the owning DOCTOR (or ADMIN) may send
   *   { amendment: "..." } (alias: amendmentNote) together with updated fields.
   *   The note is APPENDED to the amendments JSON history
   *   [{ at, byName, note }] and the fields are updated; the original content
   *   survives in the amendments history.
   */
  async update(id: string, body: UpdateEncounterBody, session: Session): Promise<EncounterDetailWithAmendments> {
    const existing = await this.encounterRepository.findWithDoctor(id);
    if (!existing) {
      log.warn("encounter_update_not_found", { encounterId: id, actor: session.userId });
      throw new NotFoundError("Encounter not found");
    }

    const isOwner = session.role === "DOCTOR" && existing.doctor.userId === session.userId;
    const isAdmin = session.role === "ADMIN";

    if (body?.status !== undefined && String(body.status) !== existing.status)
      throw new ApiError(
        existing.status === "DRAFT"
          ? "Use POST /api/encounters/:id/sign to sign an encounter"
          : "Encounter status cannot be changed via PATCH",
        400
      );

    const data: {
      chiefComplaint?: string | null;
      observations?: string | null;
      diagnosis?: string | null;
      advice?: string | null;
      followUpDate?: Date | null;
      amendments?: string;
    } = {};
    if (body?.chiefComplaint !== undefined) data.chiefComplaint = optText(body.chiefComplaint);
    if (body?.observations !== undefined) data.observations = optText(body.observations);
    if (body?.diagnosis !== undefined) data.diagnosis = optText(body.diagnosis);
    if (body?.advice !== undefined) data.advice = optText(body.advice);
    if (body?.followUpDate !== undefined) data.followUpDate = optDate(body.followUpDate);

    if (existing.status === "DRAFT") {
      if (!isOwner && !isAdmin) {
        log.warn("encounter_update_forbidden", {
          encounterId: id,
          status: existing.status,
          actor: session.userId,
        });
        throw new ApiError("Only the owning doctor can edit this draft encounter", 403);
      }
      if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);
    } else {
      // SIGNED — amendment path only.
      const note = body?.amendment ?? body?.amendmentNote;
      if (note === undefined || String(note).trim() === "") {
        log.warn("encounter_amendment_required", {
          encounterId: id,
          status: existing.status,
          actor: session.userId,
        });
        throw new ApiError(
          'Signed encounters are immutable — send { amendment: "why + what changed" } with the corrected fields to record an amendment',
          409
        );
      }
      if (!isOwner && !isAdmin) {
        log.warn("encounter_amend_forbidden", {
          encounterId: id,
          actor: session.userId,
        });
        throw new ApiError("Only the owning doctor (or an admin) can amend this encounter", 403);
      }

      const history = parseAmendments(existing.amendments);
      history.push({
        at: new Date().toISOString(),
        byName: session.name,
        note: String(note).trim(),
      });
      data.amendments = JSON.stringify(history);
    }

    const encounter = await this.encounterRepository.updateWithDetail(id, data);

    log.info(
      existing.status === "SIGNED" ? "encounter_amended" : "encounter_updated",
      {
        encounterId: id,
        status: existing.status,
        fields: Object.keys(data).filter((k) => k !== "amendments"),
        actor: session.userId,
      }
    );

    await logActivity(
      session.name,
      existing.status === "SIGNED" ? "ENCOUNTER_AMEND" : "ENCOUNTER_UPDATE",
      "ENCOUNTER",
      `${encounter.id} — fields: ${Object.keys(data).filter((k) => k !== "amendments").join(", ") || "note only"}`,
      session.userId
    );

    return { ...encounter, amendments: parseAmendments(encounter.amendments) } as EncounterDetailWithAmendments;
  }

  /**
   * POST /api/encounters/:id/sign — the owning DOCTOR (or ADMIN) signs the
   * encounter. Signed encounters are immutable; further corrections go through
   * PATCH with { amendment }.
   */
  async sign(id: string, session: Session): Promise<EncounterSignRow> {
    const existing = await this.encounterRepository.findWithDoctorForSign(id);
    if (!existing) {
      log.warn("encounter_sign_not_found", { encounterId: id, actor: session.userId });
      throw new NotFoundError("Encounter not found");
    }

    const isOwner = session.role === "DOCTOR" && existing.doctor.userId === session.userId;
    if (!isOwner && session.role !== "ADMIN") {
      log.warn("encounter_sign_forbidden", {
        encounterId: id,
        actor: session.userId,
      });
      throw new ApiError("Only the owning doctor can sign this encounter", 403);
    }

    if (existing.status === "SIGNED") {
      log.warn("encounter_sign_duplicate", {
        encounterId: id,
        actor: session.userId,
      });
      throw new ApiError("Encounter is already signed", 409);
    }

    if (!existing.diagnosis?.trim() && !existing.observations?.trim())
      throw new ApiError("Add a diagnosis or observations before signing", 400);

    const encounter = await this.encounterRepository.sign(id, {
      status: "SIGNED",
      signedAt: new Date(),
      signedByName: session.name,
    });

    log.info("encounter_signed", {
      encounterId: encounter.id,
      beneficiaryId: encounter.beneficiaryId,
      doctorId: encounter.doctorId,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "ENCOUNTER_SIGN",
      "ENCOUNTER",
      `Encounter signed for ${encounter.beneficiary.code} by ${session.name}`,
      session.userId
    );

    return encounter;
  }
}
