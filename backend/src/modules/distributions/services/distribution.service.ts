/**
 * Distribution service — field-distribution rules: listing (raw array /
 * totals envelope / unified ledger), creation with stock consumption, and
 * edit/delete with stock reversal.
 *
 * The legacy handlers validated body fields mid-handler after the
 * auth/ownership gates (volunteer and recurring-need lookups interleaved —
 * 404/403-before-400 ordering), so those checks and their exact messages live
 * here. The legacy transaction boundaries are preserved exactly: POST, PATCH
 * and DELETE ran their stock effects inside one db.$transaction — reproduced
 * with withTransaction, the tx client passed into the participating
 * repository methods and lib stock helpers.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import {
  addCycle,
  consumeItemsStock,
  consumeKitBatch,
  restoreItemsStock,
  restoreKitBatch,
  type DistItemInput,
} from "@/domains/distribution-stock";
import { buildUnifiedLedger } from "@/modules/distributions/services/distribution-ledger.domain";
import { withTransaction } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  CampaignSummary,
  DistributionCreateData,
  DistributionDetailRow,
  DistributionListRow,
  DistributionMutateSummary,
  DistributionRepository,
  DistributionRow,
  DistributionUpdateData,
  RecurringNeedSummary,
} from "../repositories/distribution.repository.interface";
import type {
  CreateDistributionBody,
  ListDistributionsQuery,
  UpdateDistributionBody,
} from "../schemas/distribution.schema";

const log = logger.child("distributions");

const TYPES = [
  "FOOD",
  "SANITARY_PADS",
  "MEDICAL",
  "ANIMAL_FEED",
  "CLOTHING",
  "EDUCATION_MATERIAL",
  "CASH",
  "OTHER",
];

/** Sanitise the items JSON payload → [{itemId?, name, qty, unit?}] array (parsed, not stringified). */
function sanitizeItemsArray(raw: unknown): DistItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((i) => {
      const o = (i ?? {}) as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      const qty = Number(o.qty ?? 1);
      const unit = String(o.unit ?? "").trim();
      const itemId = o.itemId ? String(o.itemId).trim() : undefined;
      return {
        ...(itemId ? { itemId } : {}),
        name,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        ...(unit ? { unit } : {}),
      };
    })
    .filter((i) => i.name.length > 0);
}

/** GET / withTotals=1 envelope shape. */
export interface DistributionTotalsEnvelope {
  items: Array<DistributionListRow & { campaign: CampaignSummary | null }>;
  total: number;
  count: number;
  sumValue: number;
  sumQuantity: number;
  beneficiariesServed: number;
  avgItemsPerDrive: number;
}

export class DistributionService {
  constructor(private readonly distributionRepository: DistributionRepository) {}

  /**
   * GET /api/distributions
   *   ?unified=1  → merged ledger across all four distribution systems:
   *     legacy Distribution + food-programme handovers + medication dispenses
   *     + pad drives (delegated to the shared lib builder, exact sp semantics).
   *   ?type=FOOD,MEDICAL &q= &from= &to= &volunteerId= &beneficiaryId= &campaignId=
   *   &mine=1 &limit= &offset= &withTotals=1
   * Default response = raw array (legacy callers). withTotals=1 → envelope.
   */
  async list(query: ListDistributionsQuery, sp: URLSearchParams, actor: Session): Promise<unknown> {
    // Unified ledger mode — merge all distribution sources into one feed.
    if (sp.get("unified") === "1") return buildUnifiedLedger(sp);

    let mineVolunteerId: string | undefined;
    if (query.mine) {
      const volunteer = await this.distributionRepository.findVolunteerByUserId(actor.userId);
      if (!volunteer)
        return query.withTotals
          ? {
              items: [],
              total: 0,
              count: 0,
              sumValue: 0,
              sumQuantity: 0,
              beneficiariesServed: 0,
              avgItemsPerDrive: 0,
            }
          : [];
      mineVolunteerId = volunteer.id;
    }

    const filters = {
      type: query.type,
      q: query.q,
      from: query.from,
      to: query.to,
      volunteerId: query.volunteerId,
      beneficiaryId: query.beneficiaryId,
      campaignId: query.campaignId,
      kitBatchId: query.kitBatchId,
      itemId: query.itemId,
      mineVolunteerId,
    };
    const [rows, total] = await Promise.all([
      this.distributionRepository.listDistributions(filters, query.limit, query.offset),
      this.distributionRepository.countDistributions(filters),
    ]);

    // Distribution has campaignId but no Prisma relation — attach manually.
    const campaignIds = Array.from(
      new Set(rows.map((r) => r.campaignId).filter((v): v is string => Boolean(v)))
    );
    const campaigns = campaignIds.length
      ? await this.distributionRepository.findCampaignsByIds(campaignIds)
      : [];
    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

    const items = rows.map((r) => ({
      ...r,
      campaign: r.campaignId ? campaignMap.get(r.campaignId) ?? null : null,
    }));

    if (!query.withTotals) return items;

    const [agg, served, itemRows] = await Promise.all([
      this.distributionRepository.aggregateTotals(filters),
      this.distributionRepository.listServedBeneficiaryIds(filters),
      this.distributionRepository.listItemRows(filters),
    ]);
    let itemLines = 0;
    let drivesWithItems = 0;
    for (const r of itemRows) {
      try {
        const parsed = r.items ? (JSON.parse(r.items) as unknown[]) : [];
        if (Array.isArray(parsed) && parsed.length) {
          itemLines += parsed.length;
          drivesWithItems += 1;
        }
      } catch {
        // unparseable legacy JSON — skip
      }
    }

    return {
      items,
      total,
      count: total,
      sumValue: agg.value ?? 0,
      sumQuantity: agg.quantity ?? 0,
      beneficiariesServed: served.filter((b) => b.beneficiaryId).length,
      avgItemsPerDrive:
        drivesWithItems > 0
          ? Math.round((itemLines / drivesWithItems) * 10) / 10
          : 0,
    };
  }

  /** POST /api/distributions (VOLUNTEER | ADMIN). */
  async create(body: CreateDistributionBody, actor: Session): Promise<DistributionRow> {
    const type = String(body.type ?? "").trim().toUpperCase();
    if (!TYPES.includes(type)) throw new ApiError("Invalid distribution type", 400);
    const quantity = Math.trunc(Number(body.quantity ?? 1));
    if (!Number.isFinite(quantity) || quantity < 1)
      throw new ApiError("quantity must be at least 1", 400);
    const location = String(body.location ?? "").trim();
    if (!location) throw new ApiError("location is required", 400);

    const valueNum = Number(body.value);
    const value =
      body.value !== undefined && body.value !== null && body.value !== ""
        ? Number.isFinite(valueNum)
          ? valueNum
          : null
        : null;
    if (value !== null && value < 0) throw new ApiError("value cannot be negative", 400);

    const distributedAtRaw = body.distributedAt
      ? new Date(String(body.distributedAt))
      : new Date();
    const distributedAt = Number.isNaN(distributedAtRaw.getTime())
      ? new Date()
      : distributedAtRaw;

    // Explicit volunteerId wins (admin assignment); otherwise attribute to the
    // session's own volunteer profile (ADMIN without profile → null).
    let volunteerId: string | null = null;
    if (body.volunteerId) {
      const assigned = await this.distributionRepository.findVolunteerById(
        String(body.volunteerId)
      );
      if (!assigned) {
        log.warn("distribution_volunteer_not_found", { volunteerId: body.volunteerId, actor: actor.userId });
        throw new ApiError("Volunteer not found", 400);
      }
      volunteerId = assigned.id;
    } else {
      const volunteer = await this.distributionRepository.findVolunteerByUserId(actor.userId);
      volunteerId = volunteer?.id ?? null;
    }

    const itemsArray = sanitizeItemsArray(body.items);
    const itemsJson = itemsArray.length ? JSON.stringify(itemsArray) : null;

    const kitBatchId = body.kitBatchId ? String(body.kitBatchId) : null;
    const kitQuantity = kitBatchId ? Math.trunc(Number(body.kitQuantity ?? 0)) : null;
    if (kitBatchId && (!Number.isFinite(kitQuantity) || (kitQuantity as number) < 1))
      throw new ApiError("kitQuantity must be at least 1 when a kit batch is selected", 400);

    const recurringNeedId = body.recurringNeedId ? String(body.recurringNeedId) : null;
    let recurringNeed: RecurringNeedSummary | null = null;
    if (recurringNeedId) {
      const need = await this.distributionRepository.findRecurringNeedById(recurringNeedId);
      if (!need) {
        log.warn("distribution_recurring_need_not_found", { recurringNeedId, actor: actor.userId });
        throw new ApiError("Recurring need not found", 400);
      }
      recurringNeed = need;
    }

    const row = await withTransaction(async (tx) => {
      const created = await this.distributionRepository.createDistribution(
        {
          type,
          beneficiaryId:
            body.beneficiaryId ? String(body.beneficiaryId) : recurringNeed?.beneficiaryId ?? null,
          campaignId: body.campaignId ? String(body.campaignId) : null,
          volunteerId,
          items: itemsJson,
          quantity,
          value,
          photos: body.photos ? JSON.stringify(body.photos) : null,
          location,
          notes: body.notes ? String(body.notes) : null,
          distributedAt,
          kitBatchId: kitBatchId ?? undefined,
          kitQuantity: kitQuantity ?? undefined,
          recurringNeedId: recurringNeedId ?? undefined,
        },
        tx
      );

      await consumeItemsStock(tx, created.id, itemsArray);
      if (kitBatchId && kitQuantity)
        await consumeKitBatch(tx, created.id, kitBatchId, kitQuantity, location);

      if (recurringNeed) {
        await this.distributionRepository.updateRecurringNeed(
          recurringNeed.id,
          {
            lastFulfilledAt: distributedAt,
            nextDueAt: addCycle(distributedAt, recurringNeed.cycle),
          },
          tx
        );
      }

      return created;
    });

    log.info("distribution_created", {
      distributionId: row.id,
      type,
      quantity,
      location,
      ...(kitBatchId ? { kitBatchId, kitQuantity } : {}),
      ...(recurringNeedId ? { recurringNeedId } : {}),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "DISTRIBUTION",
      "Distribution",
      `${type} ×${quantity} @ ${location}`,
      actor.userId
    );
    return row;
  }

  /** ADMIN may edit anything; VOLUNTEER only records attributed to them. */
  private async assertCanMutate(actor: Session, id: string): Promise<DistributionMutateSummary> {
    const existing = await this.distributionRepository.findDistributionForMutate(id);
    if (!existing) {
      log.warn("distribution_not_found", { distributionId: id, actor: actor.userId });
      throw new ApiError("Distribution not found", 404);
    }
    if (actor.role !== "ADMIN") {
      const own = await this.distributionRepository.findVolunteerByUserId(actor.userId);
      if (!own || existing.volunteerId !== own.id) {
        log.warn("distribution_not_owner", {
          distributionId: id,
          type: existing.type,
          actor: actor.userId,
        });
        throw new ApiError("You can only manage distributions you recorded", 403);
      }
    }
    return existing;
  }

  /** GET /api/distributions/:id (ADMIN, VOLUNTEER) — enriched detail. */
  async getById(id: string): Promise<DistributionDetailRow & { campaign: CampaignSummary | null }> {
    const row = await this.distributionRepository.findDistributionDetail(id);
    if (!row) throw new ApiError("Distribution not found", 404);

    const campaign = row.campaignId
      ? (await this.distributionRepository.findCampaignsByIds([row.campaignId]))[0] ?? null
      : null;
    return { ...row, campaign };
  }

  /**
   * PATCH /api/distributions/:id (ADMIN, or the recording VOLUNTEER).
   * Items / kit batch re-selection reverses the previous stock effect and
   * re-applies against the new lines, all inside one transaction.
   */
  async update(id: string, body: UpdateDistributionBody, actor: Session): Promise<DistributionRow> {
    await this.assertCanMutate(actor, id);

    const data: DistributionUpdateData = {};

    if (body.type !== undefined) {
      const type = String(body.type).trim().toUpperCase();
      if (!TYPES.includes(type)) throw new ApiError("Invalid distribution type", 400);
      data.type = type;
    }
    if (body.beneficiaryId !== undefined)
      data.beneficiaryId = body.beneficiaryId ? String(body.beneficiaryId) : null;
    if (body.campaignId !== undefined)
      data.campaignId = body.campaignId ? String(body.campaignId) : null;
    if (body.volunteerId !== undefined) {
      if (!body.volunteerId) data.volunteerId = null;
      else {
        const v = await this.distributionRepository.findVolunteerById(String(body.volunteerId));
        if (!v) {
          log.warn("distribution_volunteer_not_found", { volunteerId: body.volunteerId, distributionId: id, actor: actor.userId });
          throw new ApiError("Volunteer not found", 400);
        }
        data.volunteerId = v.id;
      }
    }
    if (body.quantity !== undefined) {
      const quantity = Math.trunc(Number(body.quantity));
      if (!Number.isFinite(quantity) || quantity < 1)
        throw new ApiError("quantity must be at least 1", 400);
      data.quantity = quantity;
    }
    if (body.value !== undefined) {
      if (body.value === null || body.value === "") data.value = null;
      else {
        const value = Number(body.value);
        if (!Number.isFinite(value) || value < 0)
          throw new ApiError("value must be a number ≥ 0", 400);
        data.value = value;
      }
    }
    if (body.location !== undefined) {
      const location = String(body.location).trim();
      if (!location) throw new ApiError("location cannot be empty", 400);
      data.location = location;
    }
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
    if (body.distributedAt !== undefined) {
      const d = new Date(String(body.distributedAt));
      if (Number.isNaN(d.getTime())) throw new ApiError("Invalid distributedAt date", 400);
      data.distributedAt = d;
    }

    // Items / kit batch re-selection → reverse the previous stock effect and
    // re-apply against the new lines, all inside one transaction.
    const itemsProvided = body.items !== undefined;
    const itemsArray = itemsProvided ? sanitizeItemsArray(body.items) : [];
    const kitBatchProvided = body.kitBatchId !== undefined;
    const nextKitBatchId = kitBatchProvided
      ? body.kitBatchId
        ? String(body.kitBatchId)
        : null
      : undefined;
    const nextKitQuantity = kitBatchProvided
      ? Math.trunc(Number(body.kitQuantity ?? 0)) || null
      : undefined;
    if (kitBatchProvided && nextKitBatchId && (!nextKitQuantity || nextKitQuantity < 1))
      throw new ApiError("kitQuantity must be at least 1 when a kit batch is selected", 400);

    if (itemsProvided) data.items = itemsArray.length ? JSON.stringify(itemsArray) : null;
    if (kitBatchProvided) {
      data.kitBatchId = nextKitBatchId;
      data.kitQuantity = nextKitBatchId ? nextKitQuantity : null;
    }

    const row = await withTransaction(async (tx) => {
      if (itemsProvided) await restoreItemsStock(tx, id);
      if (kitBatchProvided) await restoreKitBatch(tx, id);

      const updated = await this.distributionRepository.updateDistribution(id, data, tx);

      if (itemsProvided) await consumeItemsStock(tx, id, itemsArray);
      if (kitBatchProvided && nextKitBatchId && nextKitQuantity)
        await consumeKitBatch(tx, id, nextKitBatchId, nextKitQuantity, updated.location);

      return updated;
    });

    log.info("distribution_updated", {
      distributionId: id,
      type: row.type,
      quantity: row.quantity,
      fields: Object.keys(data),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "DISTRIBUTION_UPDATE",
      "Distribution",
      id,
      actor.userId
    );
    return row;
  }

  /** DELETE /api/distributions/:id (ADMIN, or the recording VOLUNTEER). */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.assertCanMutate(actor, id);

    await withTransaction(async (tx) => {
      await restoreItemsStock(tx, id);
      await restoreKitBatch(tx, id);
      await this.distributionRepository.deleteDistribution(id, tx);
    });

    log.info("distribution_deleted", {
      distributionId: id,
      type: existing.type,
      quantity: existing.quantity,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "DISTRIBUTION_DELETE",
      "Distribution",
      `${existing.type} ×${existing.quantity}`,
      actor.userId
    );
    return { ok: true };
  }
}
