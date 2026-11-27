/**
 * Prisma implementation of the pad distribution repository — the ONLY place
 * in the pad-distributions module that touches Prisma models directly.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import type {
  PadDistributionAggregate,
  PadDistributionCreateData,
  PadDistributionListFilter,
  PadDistributionRepository,
  PadDistributionUpdateData,
  PadDistributionVolunteerRef,
} from "./pad-distribution.repository.interface";

export class PrismaPadDistributionRepository implements PadDistributionRepository {
  /** Translates the legacy URLSearchParams filter into a Prisma where. */
  private whereFor(filter: PadDistributionListFilter): Prisma.PadDistributionWhereInput {
    const where: Prisma.PadDistributionWhereInput = {};

    if (filter.q)
      where.OR = [
        { schoolName: { contains: filter.q } },
        { area: { contains: filter.q } },
        { volunteerName: { contains: filter.q } },
        { notes: { contains: filter.q } },
      ];

    if (filter.session === true) where.awarenessSession = true;
    else if (filter.session === false) where.awarenessSession = false;

    if (filter.from || filter.to)
      where.distributionDate = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };

    if (filter.volunteerId) where.volunteerId = filter.volunteerId;

    return where;
  }

  async list(filter: PadDistributionListFilter, limit: number, offset: number) {
    const where = this.whereFor(filter);
    const [rows, total] = await Promise.all([
      db.padDistribution.findMany({
        where,
        orderBy: { distributionDate: "desc" },
        take: limit,
        skip: offset,
      }),
      db.padDistribution.count({ where }),
    ]);
    return { rows, total };
  }

  async listVolunteerNames(ids: string[]): Promise<PadDistributionVolunteerRef[]> {
    if (!ids.length) return [];
    const volunteers = await db.volunteer.findMany({
      where: { id: { in: ids } },
      select: { id: true, user: { select: { name: true } } },
    });
    return volunteers.map((v) => ({ id: v.id, name: v.user.name }));
  }

  async findVolunteerNameById(id: string): Promise<PadDistributionVolunteerRef | null> {
    const v = await db.volunteer.findUnique({
      where: { id },
      select: { id: true, user: { select: { name: true } } },
    });
    return v ? { id: v.id, name: v.user.name } : null;
  }

  async findVolunteerIdByUserId(userId: string): Promise<{ id: string } | null> {
    const v = await db.volunteer.findUnique({
      where: { userId },
      select: { id: true },
    });
    return v ?? null;
  }

  async findVolunteerIdById(id: string): Promise<{ id: string } | null> {
    const v = await db.volunteer.findUnique({
      where: { id },
      select: { id: true },
    });
    return v ?? null;
  }

  async create(data: PadDistributionCreateData) {
    return db.padDistribution.create({ data });
  }

  async findById(id: string) {
    return db.padDistribution.findUnique({ where: { id } });
  }

  async findForMutation(id: string) {
    return db.padDistribution.findUnique({
      where: { id },
      select: { id: true, volunteerId: true, area: true, padsDistributed: true },
    });
  }

  async update(id: string, data: PadDistributionUpdateData) {
    return db.padDistribution.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await db.padDistribution.delete({ where: { id } });
  }

  async aggregateTotals(filter: PadDistributionListFilter): Promise<PadDistributionAggregate> {
    const agg = await db.padDistribution.aggregate({
      where: this.whereFor(filter),
      _sum: { padsDistributed: true, girlsCount: true, sessionAttendees: true },
    });
    return {
      padsDistributed: agg._sum.padsDistributed,
      girlsCount: agg._sum.girlsCount,
      sessionAttendees: agg._sum.sessionAttendees,
    };
  }

  async countAwarenessSessions(filter: PadDistributionListFilter): Promise<number> {
    return db.padDistribution.count({
      where: { ...this.whereFor(filter), awarenessSession: true },
    });
  }

  async listDistinctSchools(filter: PadDistributionListFilter): Promise<Array<{ schoolName: string | null }>> {
    return db.padDistribution.findMany({
      where: this.whereFor(filter),
      distinct: ["schoolName"],
      select: { schoolName: true },
    });
  }
}
