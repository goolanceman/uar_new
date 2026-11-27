/**
 * Beneficiary-request service — submission and the admin review machine.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. The legacy side-effect order (log → logActivity) and every
 * legacy error message are preserved exactly.
 */
import { logger } from "@/lib/logger";
import { logActivity, type Session } from "@/lib/session";
import { assertTransition } from "@/lib/workflow";
import { ApiError } from "@/shared/errors";
import type {
  BeneficiaryRequestRepository,
  BeneficiaryRequestRow,
  BeneficiaryRequestUpdateData,
  BeneficiaryRequestWithBeneficiary,
} from "../repositories/beneficiary-request.repository.interface";

const log = logger.child("beneficiary-requests");

const URGENCIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const VALID_STATUSES = ["PENDING", "IN_REVIEW", "APPROVED", "FULFILLED", "REJECTED"];
// Review machine: triage → decide → fulfil. FULFILLED/REJECTED are terminal.
// (The food-assistance flow updates requests programmatically — a direct db
// write with its own reopen guard — and intentionally bypasses this table.)
const TRANSITIONS: Record<string, string[]> = {
  PENDING: ["IN_REVIEW", "APPROVED", "REJECTED"],
  IN_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["FULFILLED"],
  FULFILLED: [],
  REJECTED: [],
};

export class BeneficiaryRequestService {
  constructor(private readonly beneficiaryRequestRepository: BeneficiaryRequestRepository) {}

  /** GET /api/beneficiary-requests?mine=1 — the caller's own requests. */
  async listMine(userId: string): Promise<BeneficiaryRequestRow[]> {
    return this.beneficiaryRequestRepository.findMine(userId);
  }

  /** GET /api/beneficiary-requests — admin queue, optional status filter. */
  async listAll(status?: string): Promise<BeneficiaryRequestWithBeneficiary[]> {
    return this.beneficiaryRequestRepository.listAll(status);
  }

  /**
   * POST /api/beneficiary-requests — beneficiary submits. The controller
   * resolves the (optional) session; a null actor stays anonymous exactly
   * like the legacy validateSession flow. Field coercion + checks run here
   * with the legacy messages — before any DB access, as legacy did.
   */
  async create(actor: Session | null, body: Record<string, unknown>): Promise<BeneficiaryRequestRow> {
    const name = String(body?.name ?? "").trim();
    const details = String(body?.details ?? "").trim();
    if (!name || !details)
      throw new ApiError("Name and request details are required", 400);

    const urgency = String(body?.urgency ?? "MEDIUM").toUpperCase();
    if (!URGENCIES.includes(urgency))
      throw new ApiError("Invalid urgency level", 400);

    // Link to the caller's beneficiary record when one exists
    const linked = actor
      ? await this.beneficiaryRequestRepository.findBeneficiaryByUserId(actor.userId)
      : null;

    const row = await this.beneficiaryRequestRepository.create({
      beneficiaryId: body?.beneficiaryId
        ? String(body.beneficiaryId)
        : linked?.id ?? null,
      userId: actor?.userId ?? null,
      name,
      phone: body?.phone ? String(body.phone).trim() : null,
      category: body?.category ? String(body.category) : "OTHER",
      urgency,
      details,
    });

    log.info("beneficiary_request_created", {
      requestId: row.id,
      category: row.category,
      urgency: row.urgency,
      ...(row.beneficiaryId ? { beneficiaryId: row.beneficiaryId } : {}),
      ...(actor ? { actor: actor.userId } : {}),
    });

    return row;
  }

  /**
   * PATCH /api/beneficiary-requests/:id — admin reviews a request. Field
   * coercion/checks happen here, AFTER the existence lookup, preserving the
   * legacy 404-before-400 ordering and messages exactly.
   */
  async update(id: string, body: Record<string, unknown>, actor: Session): Promise<BeneficiaryRequestRow> {
    const existing = await this.beneficiaryRequestRepository.findById(id);
    if (!existing) {
      log.warn("beneficiary_request_update_not_found", { requestId: id, actor: actor.userId });
      throw new ApiError("Request not found", 404);
    }

    const data: BeneficiaryRequestUpdateData = {};
    if (body?.status !== undefined) {
      const status = String(body.status).toUpperCase();
      if (!VALID_STATUSES.includes(status))
        throw new ApiError("Invalid request status", 400);
      if (existing.status !== status && !TRANSITIONS[existing.status]?.includes(status))
        log.warn("beneficiary_request_invalid_transition", {
          requestId: id,
          from: existing.status,
          to: status,
          actor: actor.userId,
        });
      assertTransition(TRANSITIONS, existing.status, status, "beneficiary request", 400);
      data.status = status;
      data.reviewedBy = actor.name;
      data.reviewedAt = new Date();
    }
    if (body?.reviewNote !== undefined)
      data.reviewNote = body.reviewNote ? String(body.reviewNote) : null;
    if (body?.urgency !== undefined) {
      const u = String(body.urgency).toUpperCase();
      if (!URGENCIES.includes(u))
        throw new ApiError("Invalid urgency level", 400);
      data.urgency = u;
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const row = await this.beneficiaryRequestRepository.update(id, data);

    log.info("beneficiary_request_reviewed", {
      requestId: id,
      ...(data.status !== undefined ? { from: existing.status, to: row.status } : { fields: Object.keys(data) }),
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "BENEFICIARY_REQUEST_REVIEW",
      "BENEFICIARY_REQUEST",
      `${row.name}: ${row.status}`,
      actor.userId
    );

    return row;
  }

  /** DELETE /api/beneficiary-requests/:id */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.beneficiaryRequestRepository.findById(id);
    if (!existing) {
      log.warn("beneficiary_request_delete_not_found", { requestId: id, actor: actor.userId });
      throw new ApiError("Request not found", 404);
    }
    await this.beneficiaryRequestRepository.delete(id);
    log.info("beneficiary_request_deleted", {
      requestId: id,
      status: existing.status,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "BENEFICIARY_REQUEST_DELETE",
      "BENEFICIARY_REQUEST",
      existing.name,
      actor.userId
    );
    return { ok: true };
  }
}
