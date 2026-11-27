/**
 * Medical document service — all business rules for patient medical
 * documents. Depends on the repository contract, throws application errors,
 * never touches HTTP.
 *
 * The POST field checks are deliberately interleaved with beneficiary/camp
 * lookups here (404-before-400 ordering) exactly like the legacy route, and
 * the 400 messages are the bare legacy strings.
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity } from "@/infrastructure/auth/session";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { Session } from "@/infrastructure/auth/session";
import type {
  MedicalDocumentListWhere,
  MedicalDocumentRepository,
  MedicalDocumentRow,
} from "../repositories/medical-document.repository.interface";

const log = logger.child("medical-documents");

const VALID_KINDS = ["PRESCRIPTION", "LAB_REPORT", "DISCHARGE_SUMMARY", "REFERRAL", "OTHER"];
// File-manager assets (/api/files/:id/file) or absolute http(s) URLs only —
// blocks javascript:/data: injection vectors.
const URL_RE = /^(\/api\/files\/[\w-]+\/file)|^https?:\/\//;

function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export interface MedicalDocumentListPayload {
  items: MedicalDocumentRow[];
  total: number;
  page: number;
  pages: number;
}

export class MedicalDocumentService {
  constructor(private readonly medicalDocumentRepository: MedicalDocumentRepository) {}

  /**
   * GET /api/medical-documents?beneficiaryId= — staff see everything (with an
   * optional beneficiary filter); BENEFICIARY accounts are scoped to their own
   * patient record (empty page when none is linked).
   */
  async list(
    query: { page: number; limit: number; beneficiaryId?: string },
    skip: number,
    actor: Session
  ): Promise<MedicalDocumentListPayload> {
    const where: MedicalDocumentListWhere = {};
    if (actor.role === "BENEFICIARY") {
      const own = await this.medicalDocumentRepository.findBeneficiaryIdByUserId(actor.userId);
      if (!own) return { items: [], total: 0, page: 1, pages: 1 };
      where.beneficiaryId = own;
    } else if (query.beneficiaryId) {
      where.beneficiaryId = query.beneficiaryId;
    }

    const [total, items] = await Promise.all([
      this.medicalDocumentRepository.countDocuments(where),
      this.medicalDocumentRepository.listDocuments(where, skip, query.limit),
    ]);

    return { items, total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)) };
  }

  /**
   * POST /api/medical-documents — { beneficiaryId, campId?, name, kind, url }.
   * BENEFICIARY accounts always attach to their own patient record. Checks run
   * in the exact legacy order: role-scoped beneficiary resolution →
   * beneficiaryId required → beneficiary 404 → name → url (+ regex) → kind →
   * camp 404.
   */
  async create(body: Record<string, unknown>, actor: Session): Promise<MedicalDocumentRow> {
    let beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (actor.role === "BENEFICIARY") {
      const own = await this.medicalDocumentRepository.findBeneficiaryIdByUserId(actor.userId);
      if (!own) {
        log.warn("medical_document_no_patient_record", { actor: actor.userId });
        throw new ApiError("No patient record is linked to your account yet", 403);
      }
      beneficiaryId = own;
    }
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await this.medicalDocumentRepository.findBeneficiaryRef(beneficiaryId);
    if (!beneficiary) {
      log.warn("medical_document_beneficiary_not_found", {
        beneficiaryId,
        actor: actor.userId,
      });
      throw new NotFoundError("Beneficiary not found");
    }

    const name = optText(body?.name);
    if (!name) throw new ApiError("name is required", 400);

    const urlStr = optText(body?.url);
    if (!urlStr) throw new ApiError("url is required", 400);
    if (!URL_RE.test(urlStr))
      throw new ApiError("url must be a /api/files/:id/file URL or an http(s) URL", 400);

    const kind = String(body?.kind ?? "OTHER").trim().toUpperCase();
    if (!VALID_KINDS.includes(kind))
      throw new ApiError(`kind must be one of: ${VALID_KINDS.join(", ")}`, 400);

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await this.medicalDocumentRepository.findCampRef(campId);
      if (!camp) {
        log.warn("medical_document_camp_not_found", { campId, actor: actor.userId });
        throw new NotFoundError("Camp not found");
      }
    }

    const document = await this.medicalDocumentRepository.createDocument({
      beneficiaryId,
      campId,
      name,
      kind,
      url: urlStr,
      uploadedByName: actor.name,
    });

    log.info("medical_document_created", {
      documentId: document.id,
      beneficiaryId,
      ...(campId ? { campId } : {}),
      kind,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "DOCUMENT_ADD",
      "MEDICAL_DOCUMENT",
      `${kind} "${name}" added for ${beneficiary.code}`,
      actor.userId
    );

    return document;
  }

  /**
   * GET /api/medical-documents/:id — staff only beyond this point for
   * BENEFICIARY accounts: they must own the patient record the document
   * belongs to (legacy second 403 check, after the 404).
   */
  async getById(id: string, actor: Session): Promise<MedicalDocumentRow> {
    const document = await this.medicalDocumentRepository.findDocumentById(id);
    if (!document) throw new NotFoundError("Document not found");

    if (actor.role === "BENEFICIARY") {
      const own = await this.medicalDocumentRepository.findBeneficiaryIdByUserId(actor.userId);
      if (!own || own !== document.beneficiaryId)
        throw new ApiError("You do not have permission for this action", 403);
    }

    return document;
  }

  /** DELETE /api/medical-documents/:id — ADMIN only (role gate at the route). */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.medicalDocumentRepository.findDocumentForDelete(id);
    if (!existing) {
      log.warn("medical_document_delete_not_found", { documentId: id, actor: actor.userId });
      throw new NotFoundError("Document not found");
    }

    await this.medicalDocumentRepository.deleteDocument(id);

    log.info("medical_document_deleted", {
      documentId: id,
      kind: existing.kind,
      beneficiaryId: existing.beneficiaryId,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "DOCUMENT_DELETE",
      "MEDICAL_DOCUMENT",
      `"${existing.name}" (${existing.kind}) removed from ${existing.beneficiary.code}`,
      actor.userId
    );

    return { ok: true };
  }
}
