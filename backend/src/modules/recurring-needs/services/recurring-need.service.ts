/**
 * Recurring-need service — scheduling rules for beneficiaries' standing needs:
 * cycle validation (WEEKLY | MONTHLY | QUARTERLY), per-cycle quantities,
 * start-date seeding of nextDueAt, pause/resume/complete status edits. Depends
 * on the repository contract, throws application errors, never touches HTTP.
 *
 * The legacy handlers read the body raw (NO `?? {}` normalization) and
 * validated fields mid-handler after the existence lookups, so those checks
 * and their exact messages live here in the original order.
 */
import { logger } from "@/lib/logger";
import { RECURRING_NEED_STATUSES } from "@/lib/recurring-needs";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import type {
  CreateRecurringNeedData,
  RecurringNeedListFilter,
  RecurringNeedRepository,
  RecurringNeedUpdated,
  RecurringNeedWithRelations,
  UpdateRecurringNeedData,
} from "../repositories/recurring-need.repository.interface";
import type { ListRecurringNeedsQuery } from "../schemas/recurring-need.schema";

const log = logger.child("recurring-needs");

const CYCLES = ["WEEKLY", "MONTHLY", "QUARTERLY"];
const STATUSES = RECURRING_NEED_STATUSES;

export class RecurringNeedService {
  constructor(private readonly recurringNeedRepository: RecurringNeedRepository) {}

  /**
   * GET /api/recurring-needs?beneficiaryId=&itemId=&status=&dueBy= (staff).
   * Invalid status values (outside RECURRING_NEED_STATUSES) and unparseable
   * dueBy dates are silently ignored — exactly like the legacy handler.
   */
  async list(query: ListRecurringNeedsQuery): Promise<RecurringNeedWithRelations[]> {
    const filter: RecurringNeedListFilter = {
      beneficiaryId: query.beneficiaryId,
      itemId: query.itemId,
      status: query.status && STATUSES.includes(query.status) ? query.status : undefined,
    };
    if (query.dueBy) {
      const d = new Date(query.dueBy);
      if (!Number.isNaN(d.getTime())) filter.dueByOrBefore = d;
    }
    return this.recurringNeedRepository.list(filter);
  }

  /** POST /api/recurring-needs — register a beneficiary's standing need. */
  async create(actor: Session, body: Record<string, unknown>): Promise<RecurringNeedWithRelations> {
    const beneficiaryId = String(body.beneficiaryId ?? "").trim();
    const itemId = String(body.itemId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    if (!itemId) throw new ApiError("itemId is required", 400);

    const beneficiary = await this.recurringNeedRepository.findBeneficiaryById(beneficiaryId);
    if (!beneficiary) {
      log.warn("recurring_need_beneficiary_not_found", { beneficiaryId, actor: actor.userId });
      throw new ApiError("Beneficiary not found", 404);
    }
    const item = await this.recurringNeedRepository.findItemById(itemId);
    if (!item) {
      log.warn("recurring_need_item_not_found", { itemId, actor: actor.userId });
      throw new ApiError("Inventory item not found", 404);
    }

    const cycle = String(body.cycle ?? "MONTHLY").trim().toUpperCase();
    if (!CYCLES.includes(cycle)) throw new ApiError("Invalid cycle", 400);

    const qtyPerCycle = Math.max(1, Math.trunc(Number(body.qtyPerCycle) || 1));
    const startDate = body.startDate ? new Date(String(body.startDate)) : new Date();
    if (Number.isNaN(startDate.getTime())) throw new ApiError("Invalid startDate", 400);

    const data: CreateRecurringNeedData = {
      beneficiaryId,
      itemId,
      qtyPerCycle,
      cycle,
      reason: body.reason ? String(body.reason).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
      startDate,
      // The schedule seed: the first cycle is due on the start date.
      nextDueAt: startDate,
    };

    const row = await this.recurringNeedRepository.create(data);

    log.info("recurring_need_created", {
      recurringNeedId: row.id,
      beneficiaryId,
      itemId,
      cycle,
      qtyPerCycle,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "CREATE",
      "RecurringNeed",
      `${beneficiary.name} → ${item.name} ×${qtyPerCycle}/${cycle}`,
      actor.userId
    );

    return row;
  }

  /** PATCH /api/recurring-needs/:id — edit qty/cycle, pause/resume/complete. */
  async update(actor: Session, id: string, body: Record<string, unknown>): Promise<RecurringNeedUpdated> {
    const existing = await this.recurringNeedRepository.findById(id);
    if (!existing) {
      log.warn("recurring_need_update_not_found", { recurringNeedId: id, actor: actor.userId });
      throw new ApiError("Recurring need not found", 404);
    }

    const data: UpdateRecurringNeedData = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
      data.status = status;
    }
    if (body.cycle !== undefined) {
      const cycle = String(body.cycle).trim().toUpperCase();
      if (!CYCLES.includes(cycle)) throw new ApiError("Invalid cycle", 400);
      data.cycle = cycle;
    }
    if (body.qtyPerCycle !== undefined) {
      const q = Math.max(1, Math.trunc(Number(body.qtyPerCycle) || 1));
      data.qtyPerCycle = q;
    }
    if (body.nextDueAt !== undefined) {
      const d = new Date(String(body.nextDueAt));
      if (Number.isNaN(d.getTime())) throw new ApiError("Invalid nextDueAt", 400);
      data.nextDueAt = d;
    }
    if (body.reason !== undefined) data.reason = body.reason ? String(body.reason).trim() : null;
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const row = await this.recurringNeedRepository.update(id, data);

    log.info("recurring_need_updated", {
      recurringNeedId: id,
      fields: Object.keys(data),
      ...(data.status ? { newStatus: data.status } : {}),
      actor: actor.userId,
    });
    await logActivity(actor.name, "UPDATE", "RecurringNeed", JSON.stringify(data), actor.userId);
    return row;
  }

  /** DELETE /api/recurring-needs/:id (ADMIN only) — cancel a standing need. */
  async remove(actor: Session, id: string): Promise<{ ok: boolean }> {
    const existing = await this.recurringNeedRepository.findById(id);
    if (!existing) {
      log.warn("recurring_need_delete_not_found", { recurringNeedId: id, actor: actor.userId });
      throw new ApiError("Recurring need not found", 404);
    }

    await this.recurringNeedRepository.remove(id);
    log.info("recurring_need_deleted", { recurringNeedId: id, actor: actor.userId });
    await logActivity(actor.name, "DELETE", "RecurringNeed", id, actor.userId);
    return { ok: true };
  }
}
