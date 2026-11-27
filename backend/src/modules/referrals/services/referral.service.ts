/**
 * Referral service — referral workflow rules (shared chain definition in
 * @/modules/referrals/services/referrals.domain; any strictly-forward move plus the terminal side exits).
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. Field checks keep their exact legacy messages and ordering
 * (404-before-400 interleaving with DB lookups preserved).
 */
import { logger } from "@/infrastructure/logging/logger";
import { REFERRAL_FLOW, REFERRAL_TERMINAL_STATUSES, referralTransitions } from "@/modules/referrals/services/referrals.domain";
import { nextRefCode } from "@/domains/health-codes";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { ApiError, NotFoundError, ConflictError } from "@/shared/errors";
import type {
  CreateReferralData,
  ReferralListScope,
  ReferralRepository,
  UpdateReferralData,
} from "../repositories/referral.repository.interface";
import type { ListReferralsQuery } from "../schemas/referral.schema";

const log = logger.child("referrals");

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "EMERGENCY"];

// Shared workflow definition; any strictly-forward move is allowed.
const CHAIN: readonly string[] = REFERRAL_FLOW;
const TERMINAL_CANCELLED: readonly string[] = REFERRAL_TERMINAL_STATUSES;

/** Legacy optText(): String(v).trim(), empty/absent → null. */
function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export interface ReferralListPayload {
  items: unknown[];
  total: number;
  page: number;
  pages: number;
}

export class ReferralService {
  constructor(private readonly referralRepository: ReferralRepository) {}

  /**
   * GET /api/referrals — ADMIN | DOCTOR | NURSE see all; HOSPITAL users see
   * only referrals addressed to their own organisation; BENEFICIARY sees own.
   * Filters: beneficiaryId, status, priority.
   */
  async list(session: Session, query: ListReferralsQuery): Promise<ReferralListPayload> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const scope: ReferralListScope = {};
    if (session.role === "HOSPITAL") {
      const org = await this.referralRepository.findOrgByOwner(session.userId);
      if (!org) throw new ApiError("No healthcare organisation is linked to your account", 403);
      scope.receivingOrgId = org.id;
    } else if (session.role === "BENEFICIARY") {
      const own = await this.referralRepository.findBeneficiaryByUser(session.userId);
      if (!own) return { items: [], total: 0, page: 1, pages: 1 };
      scope.beneficiaryId = own.id;
    } else {
      scope.beneficiaryId = query.beneficiaryId;
      scope.status = query.status;
      scope.priority = query.priority;
    }

    const { items, total } = await this.referralRepository.list(scope, skip, limit);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /**
   * POST /api/referrals — DOCTOR | ADMIN.
   * { beneficiaryId, campId?, encounterId?, reason, priority, receivingOrgId?,
   *   speciality? } → code UAR-REF-NNNNN, status CREATED.
   */
  async create(body: Record<string, unknown>, session: Session): Promise<unknown> {
    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await this.referralRepository.findBeneficiaryById(beneficiaryId);
    if (!beneficiary) {
      log.warn("referral_beneficiary_not_found", {
        beneficiaryId,
        actor: session.userId,
      });
      throw new NotFoundError("Beneficiary not found");
    }

    const reason = optText(body?.reason);
    if (!reason) throw new ApiError("reason is required", 400);

    const priority = String(body?.priority ?? "MEDIUM").trim().toUpperCase();
    if (!VALID_PRIORITIES.includes(priority))
      throw new ApiError(`priority must be one of: ${VALID_PRIORITIES.join(", ")}`, 400);

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await this.referralRepository.findCampById(campId);
      if (!camp) {
        log.warn("referral_camp_not_found", { campId, actor: session.userId });
        throw new NotFoundError("Camp not found");
      }
    }
    const encounterId = optText(body?.encounterId);
    if (encounterId) {
      const enc = await this.referralRepository.findEncounterById(encounterId);
      if (!enc) {
        log.warn("referral_encounter_not_found", {
          encounterId,
          actor: session.userId,
        });
        throw new NotFoundError("Encounter not found");
      }
    }
    const receivingOrgId = optText(body?.receivingOrgId);
    if (receivingOrgId) {
      const org = await this.referralRepository.findOrgById(receivingOrgId);
      if (!org) {
        log.warn("referral_org_not_found", {
          receivingOrgId,
          actor: session.userId,
        });
        throw new NotFoundError("Receiving organisation not found");
      }
    }

    const code = await nextRefCode();
    const data: CreateReferralData = {
      code,
      beneficiaryId,
      campId,
      encounterId,
      reason,
      priority,
      receivingOrgId,
      speciality: optText(body?.speciality),
      referralDoctorName: session.name,
      status: "CREATED",
    };
    const referral = await this.referralRepository.create(data);

    log.info("referral_created", {
      referralId: (referral as { id: string }).id,
      code,
      beneficiaryId,
      priority,
      ...(campId ? { campId } : {}),
      ...(receivingOrgId ? { receivingOrgId } : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "REFERRAL_CREATE",
      "REFERRAL",
      `${code} (${priority}) for ${beneficiary.code} — ${reason}`,
      session.userId
    );

    return referral;
  }

  /**
   * GET /api/referrals/:id — ADMIN | DOCTOR | NURSE; HOSPITAL users only for
   * referrals addressed to their own organisation.
   */
  async get(id: string, session: Session): Promise<unknown> {
    const referral = await this.referralRepository.findByIdWithFollowUps(id);
    if (!referral) throw new NotFoundError("Referral not found");

    if (session.role === "HOSPITAL") {
      const org = await this.referralRepository.findOrgByOwner(session.userId);
      const receivingOrgId = (referral as { receivingOrgId: string | null }).receivingOrgId;
      if (!org || receivingOrgId !== org.id)
        throw new ApiError("You do not have permission for this action", 403);
    }

    return referral;
  }

  /**
   * PATCH /api/referrals/:id
   * - ADMIN | DOCTOR: forward status moves along
   *   CREATED→SHARED→ACCEPTED→SCHEDULED→ATTENDED→REPORT_RECEIVED→COMPLETED,
   *   plus CANCELLED / LOST_TO_FOLLOWUP from most states; notes may be updated.
   * - The receiving organisation's HOSPITAL user may set ACCEPTED only (and only
   *   on referrals addressed to their own org).
   */
  async update(
    id: string,
    body: Record<string, unknown>,
    session: Session
  ): Promise<unknown> {
    const existing = await this.referralRepository.findById(id);
    if (!existing) {
      log.warn("referral_update_not_found", { referralId: id, actor: session.userId });
      throw new NotFoundError("Referral not found");
    }

    const data: UpdateReferralData = {};

    if (session.role === "HOSPITAL") {
      const org = await this.referralRepository.findOrgByOwner(session.userId);
      if (!org || existing.receivingOrgId !== org.id) {
        log.warn("referral_update_forbidden", {
          referralId: id,
          receivingOrgId: existing.receivingOrgId,
          actor: session.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
      const target = String(body?.status ?? "");
      if (target !== "ACCEPTED") {
        log.warn("referral_hospital_status_forbidden", {
          referralId: id,
          to: target,
          actor: session.userId,
        });
        throw new ApiError("Hospital users may only set referral status to ACCEPTED", 403);
      }
      if (!["CREATED", "SHARED"].includes(existing.status)) {
        log.warn("referral_accept_blocked_status", {
          referralId: id,
          status: existing.status,
          actor: session.userId,
        });
        throw new ConflictError(`Cannot accept a referral in status ${existing.status}`);
      }
      data.status = "ACCEPTED";
    } else if (body?.status !== undefined && String(body.status) !== existing.status) {
      const target = String(body.status).trim();
      if (!CHAIN.includes(target) && !TERMINAL_CANCELLED.includes(target))
        throw new ApiError(
          `status must be a forward move along ${CHAIN.join("→")} or ${TERMINAL_CANCELLED.join("/")}`,
          400
        );
      if (!referralTransitions(existing.status).includes(target)) {
        log.warn("referral_invalid_transition", {
          referralId: id,
          code: existing.code,
          from: existing.status,
          to: target,
          actor: session.userId,
        });
        throw new ConflictError(
          CHAIN.includes(target)
            ? existing.status === "CREATED"
              ? `Invalid transition CREATED → ${target}. Expected CREATED → SHARED`
              : `Invalid transition ${existing.status} → ${target} — status can only move forward`
            : existing.status === "COMPLETED"
              ? "Completed referrals cannot be cancelled"
              : `Referral is already ${existing.status} (terminal)`
        );
      }
      data.status = target;
    }

    if (body?.notes !== undefined) data.notes = optText(body.notes);

    if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);

    const referral = await this.referralRepository.update(id, data);

    log.info("referral_updated", {
      referralId: id,
      code: existing.code,
      fields: Object.keys(data),
      ...(data.status !== undefined
        ? { from: existing.status, to: String(data.status) }
        : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      data.status ? `REFERRAL_${String(data.status)}` : "REFERRAL_UPDATE",
      "REFERRAL",
      `${existing.code} — ${data.status ? `${existing.status} → ${String(data.status)}` : "notes updated"}`,
      session.userId
    );

    return referral;
  }
}
