/**
 * Follow-up service — all business rules for patient follow-ups. Depends on
 * the repository contract, throws application errors, never touches HTTP.
 *
 * POST/PATCH field checks are deliberately interleaved with beneficiary/camp/
 * referral lookups here (404-before-400 ordering) exactly like the legacy
 * route, and the 400 messages are the bare legacy strings. DONE/MISSED/
 * CANCELLED are terminal — no reopen, no relabel (assertTransition 409).
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity } from "@/infrastructure/auth/session";
import { assertTransition } from "@/shared/workflow";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { Session } from "@/infrastructure/auth/session";
import type {
  FollowUpListWhere,
  FollowUpRepository,
  FollowUpRow,
  FollowUpUpdateData,
  FollowUpUpdateRow,
} from "../repositories/follow-up.repository.interface";

const log = logger.child("follow-ups");

const VALID_STATUSES = ["DONE", "MISSED", "CANCELLED"];
// PENDING opens; DONE/MISSED/CANCELLED are terminal — no reopen, no relabel.
const TRANSITIONS: Record<string, string[]> = {
  PENDING: ["DONE", "MISSED", "CANCELLED"],
  DONE: [],
  MISSED: [],
  CANCELLED: [],
};

function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export interface FollowUpListPayload {
  items: FollowUpRow[];
  total: number;
  page: number;
  pages: number;
}

export class FollowUpService {
  constructor(private readonly followUpRepository: FollowUpRepository) {}

  /**
   * GET /api/follow-ups — filters beneficiaryId/status, BENEFICIARY accounts
   * are scoped to their own patient record, overdue=1 pins status to PENDING
   * with a dueDate < now and orders by due date (legacy override order).
   */
  async list(
    query: { page: number; limit: number; beneficiaryId?: string; status?: string; overdue?: string },
    skip: number,
    actor: Session
  ): Promise<FollowUpListPayload> {
    const where: FollowUpListWhere = {};
    if (query.beneficiaryId) where.beneficiaryId = query.beneficiaryId;
    if (query.status) where.status = query.status;
    if (actor.role === "BENEFICIARY") {
      const own = await this.followUpRepository.findBeneficiaryIdByUserId(actor.userId);
      if (!own) return { items: [], total: 0, page: 1, pages: 1 };
      where.beneficiaryId = own;
    }
    const overdueOnly = query.overdue === "1";
    if (overdueOnly) {
      where.status = "PENDING";
      where.dueBefore = new Date();
    }

    const { rows, total } = await this.followUpRepository.listFollowUps(
      where,
      skip,
      query.limit,
      overdueOnly
    );

    return { items: rows, total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)) };
  }

  /**
   * POST /api/follow-ups — { beneficiaryId, campId?, referralId?, dueDate,
   * instructions?, ownerName? } → status PENDING. Checks run in the exact
   * legacy order: beneficiaryId required → beneficiary 404 → dueDate valid →
   * camp 404 → referral 404.
   */
  async create(body: Record<string, unknown>, actor: Session): Promise<FollowUpRow> {
    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await this.followUpRepository.findBeneficiaryRef(beneficiaryId);
    if (!beneficiary) {
      log.warn("follow_up_beneficiary_not_found", {
        beneficiaryId,
        actor: actor.userId,
      });
      throw new NotFoundError("Beneficiary not found");
    }

    const dueDate = body?.dueDate ? new Date(String(body.dueDate)) : null;
    if (!dueDate || Number.isNaN(dueDate.getTime()))
      throw new ApiError("A valid dueDate is required", 400);

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await this.followUpRepository.findCampRef(campId);
      if (!camp) {
        log.warn("follow_up_camp_not_found", { campId, actor: actor.userId });
        throw new NotFoundError("Camp not found");
      }
    }
    const referralId = optText(body?.referralId);
    if (referralId) {
      const ref = await this.followUpRepository.findReferralRef(referralId);
      if (!ref) {
        log.warn("follow_up_referral_not_found", {
          referralId,
          actor: actor.userId,
        });
        throw new NotFoundError("Referral not found");
      }
    }

    const followUp = await this.followUpRepository.createFollowUp({
      beneficiaryId,
      campId,
      referralId,
      dueDate,
      instructions: optText(body?.instructions),
      ownerName: optText(body?.ownerName),
      status: "PENDING",
    });

    log.info("follow_up_created", {
      followUpId: followUp.id,
      beneficiaryId,
      ...(campId ? { campId } : {}),
      ...(referralId ? { referralId } : {}),
      dueDate: dueDate.toISOString().slice(0, 10),
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "FOLLOWUP_CREATE",
      "FOLLOW_UP",
      `Follow-up for ${beneficiary.code} due ${dueDate.toISOString().slice(0, 10)}`,
      actor.userId
    );

    return followUp;
  }

  /** GET /api/follow-ups/:id (ADMIN | DOCTOR | NURSE | VOLUNTEER). */
  async getById(id: string): Promise<FollowUpRow> {
    const followUp = await this.followUpRepository.findFollowUpById(id);
    if (!followUp) throw new NotFoundError("Follow-up not found");
    return followUp;
  }

  /**
   * PATCH /api/follow-ups/:id — { status: DONE | MISSED | CANCELLED, outcome? }
   * — DONE stamps doneAt. The 404 fires before body processing; empty patches
   * render the bare "Nothing to update" 400.
   */
  async update(id: string, body: Record<string, unknown>, actor: Session): Promise<FollowUpUpdateRow> {
    const existing = await this.followUpRepository.findFollowUpPlain(id);
    if (!existing) {
      log.warn("follow_up_update_not_found", { followUpId: id, actor: actor.userId });
      throw new NotFoundError("Follow-up not found");
    }

    const data: FollowUpUpdateData = {};
    if (body?.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!VALID_STATUSES.includes(status))
        throw new ApiError(`status must be one of: ${VALID_STATUSES.join(", ")}`, 400);
      if (existing.status !== status && !TRANSITIONS[existing.status]?.includes(status))
        log.warn("follow_up_invalid_transition", {
          followUpId: id,
          from: existing.status,
          to: status,
          actor: actor.userId,
        });
      assertTransition(TRANSITIONS, existing.status, status, "follow-up");
      data.status = status;
      if (status === "DONE") data.doneAt = new Date();
      else data.doneAt = null;
    }
    if (body?.outcome !== undefined) data.outcome = optText(body.outcome);

    if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);

    const followUp = await this.followUpRepository.updateFollowUp(id, data);

    log.info("follow_up_updated", {
      followUpId: id,
      fields: Object.keys(data),
      ...(data.status !== undefined ? { newStatus: followUp.status } : {}),
      actor: actor.userId,
    });

    const done = data.status === "DONE";
    await logActivity(
      actor.name,
      done ? "FOLLOWUP_DONE" : "FOLLOWUP_UPDATE",
      "FOLLOW_UP",
      `Follow-up for ${followUp.beneficiary.code} — ${done ? "completed" : `status ${followUp.status}`}`,
      actor.userId
    );

    return followUp;
  }
}
