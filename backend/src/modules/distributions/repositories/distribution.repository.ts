/**
 * Prisma implementation of the distribution repository — the ONLY place in
 * the distributions module that touches Prisma models directly.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  CampaignSummary,
  DistributionCreateData,
  DistributionDetailRow,
  DistributionListFilters,
  DistributionListRow,
  DistributionMutateSummary,
  DistributionRepository,
  DistributionRow,
  DistributionUpdateData,
  RecurringNeedSummary,
  Tx,
  VolunteerRow,
} from "./distribution.repository.interface";

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

/** End-of-day for date-only `to` values so ranges are inclusive. */
function parseFrom(raw: string | undefined): Date | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseTo(raw: string | undefined): Date | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999` : v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const INCLUDE = {
  beneficiary: {
    select: {
      id: true,
      name: true,
      category: true,
      urgencyLevel: true,
      city: true,
      familyMembers: true,
    },
  },
  volunteer: { include: { user: { select: { name: true } } } },
} satisfies Prisma.DistributionInclude;

export class PrismaDistributionRepository implements DistributionRepository {
  async findVolunteerByUserId(userId: string): Promise<VolunteerRow | null> {
    return db.volunteer.findUnique({ where: { userId } });
  }

  async findVolunteerById(id: string): Promise<VolunteerRow | null> {
    return db.volunteer.findUnique({ where: { id } });
  }

  async findRecurringNeedById(id: string): Promise<RecurringNeedSummary | null> {
    return db.recurringNeed.findUnique({ where: { id } });
  }

  /** Legacy buildWhere — moved verbatim from the route (trim/split/parse
   *  semantics and the mine override included). */
  private buildWhere(filters: DistributionListFilters): Prisma.DistributionWhereInput {
    const where: Prisma.DistributionWhereInput = {};

    const type = filters.type?.trim();
    if (type && type.toUpperCase() !== "ALL") {
      const list = Array.from(
        new Set(
          type
            .split(",")
            .map((t) => t.trim().toUpperCase())
            .filter((t) => TYPES.includes(t))
        )
      );
      if (list.length === 1) where.type = list[0];
      else if (list.length > 1) where.type = { in: list };
    }

    const q = filters.q?.trim();
    if (q)
      where.OR = [
        { location: { contains: q } },
        { notes: { contains: q } },
        { items: { contains: q } },
        { beneficiary: { is: { name: { contains: q } } } },
        { beneficiary: { is: { city: { contains: q } } } },
      ];

    const from = parseFrom(filters.from);
    const to = parseTo(filters.to);
    if (from || to)
      where.distributedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };

    const volunteerId = filters.volunteerId?.trim();
    if (volunteerId) where.volunteerId = volunteerId;

    const beneficiaryId = filters.beneficiaryId?.trim();
    if (beneficiaryId) where.beneficiaryId = beneficiaryId;

    const campaignId = filters.campaignId?.trim();
    if (campaignId) where.campaignId = campaignId;

    const kitBatchId = filters.kitBatchId?.trim();
    if (kitBatchId) where.kitBatchId = kitBatchId;

    const itemId = filters.itemId?.trim();
    if (itemId) where.items = { contains: itemId };

    if (filters.mineVolunteerId) where.volunteerId = filters.mineVolunteerId;

    return where;
  }

  async listDistributions(
    filters: DistributionListFilters,
    limit: number,
    offset: number
  ): Promise<DistributionListRow[]> {
    const rows = await db.distribution.findMany({
      where: this.buildWhere(filters),
      orderBy: { distributedAt: "desc" },
      take: limit,
      skip: offset,
      include: INCLUDE,
    });
    return rows as DistributionListRow[];
  }

  async countDistributions(filters: DistributionListFilters): Promise<number> {
    return db.distribution.count({ where: this.buildWhere(filters) });
  }

  async findCampaignsByIds(ids: string[]): Promise<CampaignSummary[]> {
    return db.campaign.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        accent: true,
        status: true,
        targetAmount: true,
        raisedAmount: true,
      },
    });
  }

  async aggregateTotals(
    filters: DistributionListFilters
  ): Promise<{ value: number | null; quantity: number | null }> {
    const agg = await db.distribution.aggregate({
      where: this.buildWhere(filters),
      _sum: { value: true, quantity: true },
    });
    return { value: agg._sum.value, quantity: agg._sum.quantity };
  }

  async listServedBeneficiaryIds(
    filters: DistributionListFilters
  ): Promise<{ beneficiaryId: string | null }[]> {
    return db.distribution.findMany({
      where: this.buildWhere(filters),
      distinct: ["beneficiaryId"],
      select: { beneficiaryId: true },
    });
  }

  async listItemRows(filters: DistributionListFilters): Promise<{ items: string | null }[]> {
    return db.distribution.findMany({
      where: this.buildWhere(filters),
      select: { items: true },
    });
  }

  async findDistributionDetail(id: string): Promise<DistributionDetailRow | null> {
    const row = await db.distribution.findUnique({
      where: { id },
      include: {
        beneficiary: {
          select: {
            id: true,
            name: true,
            category: true,
            urgencyLevel: true,
            city: true,
            familyMembers: true,
          },
        },
        volunteer: { include: { user: { select: { name: true } } } },
        inventoryDistributions: { include: { item: true } },
        kitBatch: { include: { template: true } },
      },
    });
    return (row as DistributionDetailRow | null) ?? null;
  }

  async findDistributionForMutate(id: string): Promise<DistributionMutateSummary | null> {
    return db.distribution.findUnique({
      where: { id },
      select: { id: true, volunteerId: true, type: true, quantity: true },
    });
  }

  async createDistribution(
    data: DistributionCreateData,
    client?: DbClient
  ): Promise<DistributionRow> {
    const c = (client ?? db) as Tx;
    return mapPrismaError(() =>
      c.distribution.create({ data: data as Prisma.DistributionUncheckedCreateInput })
    );
  }

  async updateDistribution(
    id: string,
    data: DistributionUpdateData,
    client?: DbClient
  ): Promise<DistributionRow> {
    const c = (client ?? db) as Tx;
    return mapPrismaError(() =>
      c.distribution.update({
        where: { id },
        data: data as Prisma.DistributionUncheckedUpdateInput,
      })
    );
  }

  async deleteDistribution(id: string, client?: DbClient): Promise<void> {
    const c = (client ?? db) as Tx;
    await c.distribution.delete({ where: { id } });
  }

  async updateRecurringNeed(
    id: string,
    data: { lastFulfilledAt: Date; nextDueAt: Date },
    client?: DbClient
  ): Promise<void> {
    const c = (client ?? db) as Tx;
    await c.recurringNeed.update({ where: { id }, data });
  }
}
