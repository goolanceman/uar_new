/**
 * Pledge service — medicine-pledge business rules. Depends on the repository
 * contract, throws application errors, never touches HTTP.
 *
 * The legacy PATCH validated the status field AFTER the pledge lookup and the
 * ownership gate (404 wins over 400), so that coercion and its exact message
 * live here instead of in a route-level Zod schema. Every mutation recomputes
 * the linked cause and drops the causes cache, exactly like the legacy routes.
 */
import { logger } from "@/lib/logger";
import { recomputeCause } from "@/lib/causes";
import { invalidateCauses } from "@/lib/cache";
import { pledgeSchedule, pledgeInstallments } from "@/lib/recurring";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import type {
  PledgeListFilter,
  PledgeRepository,
  PledgeRow,
  PledgeWithCause,
} from "../repositories/pledge.repository.interface";

const log = logger.child("pledges");

const STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"];

export interface PledgeScheduleView {
  totalCommitted: number;
  paymentsMade: number;
  paymentCount: number;
  remaining: number;
  nextDueAt: Date | null;
  schedule: Array<{ n: number; dueDate: Date; amount: number; covered: boolean }>;
}

export interface PledgeInstallment {
  id: string;
  receiptNumber: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  createdAt: Date;
}

export interface PledgeWithSchedule extends PledgeWithCause, PledgeScheduleView {
  installments: PledgeInstallment[];
}

export class PledgeService {
  constructor(private readonly pledgeRepository: PledgeRepository) {}

  /** GET /api/pledges?status=&q= — admin list of all medicine pledges. */
  async list(filter: PledgeListFilter): Promise<PledgeWithCause[]> {
    return this.pledgeRepository.listAll(filter);
  }

  /**
   * GET /api/pledges/mine — the signed-in donor's pledges with the full
   * payment schedule: months × amountPerMonth from startDate, payments made
   * (linked donations), remaining commitment and next due date.
   */
  async listMine(actor: Session): Promise<PledgeWithSchedule[]> {
    const pledges = await this.pledgeRepository.listByDonor(actor.userId);
    const ids = pledges.map((p) => p.id);
    const payments = ids.length
      ? await this.pledgeRepository.findDonationsForPledges(ids)
      : [];
    return pledges.map((p) => {
      const mine = payments.filter((d) => d.pledgeId === p.id);
      return {
        ...p,
        ...pledgeSchedule(p, mine),
        installments: pledgeInstallments(mine),
      };
    });
  }

  /** GET /api/pledges/:id — one pledge + schedule + payments (owner or ADMIN). */
  async getById(id: string, actor: Session): Promise<PledgeWithSchedule> {
    const pledge = await this.pledgeRepository.findWithCauseById(id);
    if (!pledge) throw new ApiError("Pledge not found", 404);
    if (pledge.donorId !== actor.userId && actor.role !== "ADMIN")
      throw new ApiError("You can only view your own pledges", 403);
    const payments = await this.pledgeRepository.findDonationsForPledge(pledge.id);
    return {
      ...pledge,
      ...pledgeSchedule(pledge, payments),
      installments: pledgeInstallments(payments),
    };
  }

  /** PATCH /api/pledges/:id — ADMIN or the pledge's own donor. */
  async update(id: string, body: Record<string, unknown>, actor: Session): Promise<PledgeRow> {
    const pledge = await this.pledgeRepository.findById(id);
    if (!pledge) {
      log.warn("pledge_update_not_found", { pledgeId: id, actor: actor.userId });
      throw new ApiError("Pledge not found", 404);
    }

    const isOwner = Boolean(pledge.donorId) && pledge.donorId === actor.userId;
    if (actor.role !== "ADMIN" && !isOwner) {
      log.warn("pledge_update_forbidden", { pledgeId: id, actor: actor.userId });
      throw new ApiError("You can only manage your own pledges", 403);
    }

    const status = String(body.status ?? "").trim().toUpperCase();
    if (!STATUSES.includes(status))
      throw new ApiError("status must be ACTIVE, COMPLETED or CANCELLED", 400);

    const updated = await this.pledgeRepository.updateStatus(id, status);
    await recomputeCause(updated.causeId);
    await invalidateCauses();
    log.info("pledge_updated", {
      pledgeId: id,
      causeId: updated.causeId,
      status,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "PLEDGE_UPDATE",
      "Pledge",
      `${id} → ${status}`,
      actor.userId
    );
    return updated;
  }

  /** DELETE /api/pledges/:id (ADMIN). */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const pledge = await this.pledgeRepository.findById(id);
    if (!pledge) {
      log.warn("pledge_delete_not_found", { pledgeId: id, actor: actor.userId });
      throw new ApiError("Pledge not found", 404);
    }

    await this.pledgeRepository.deletePledge(id);
    log.info("pledge_deleted", {
      pledgeId: id,
      causeId: pledge.causeId,
      actor: actor.userId,
    });
    await recomputeCause(pledge.causeId);
    await invalidateCauses();
    await logActivity(actor.name, "PLEDGE_DELETE", "Pledge", id, actor.userId);
    return { ok: true };
  }
}
