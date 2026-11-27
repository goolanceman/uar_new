/**
 * Prisma implementation of the campaign repository — the ONLY place in the
 * campaigns module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { Prisma } from "@prisma/client";
import type {
  CampaignListFilter,
  CampaignRepository,
  CampaignRow,
  SupporterCountRow,
  TrendVolumeRow,
} from "./campaign.repository.interface";

export class PrismaCampaignRepository implements CampaignRepository {
  /** Legacy where-building: drafts hidden unless admin asked for `all`;
   *  an explicit status filter overrides the draft exclusion; urgent-only
   *  keeps appeals whose deadline has not passed (auto-expire); search hits
   *  title/tagline/description case-insensitively. */
  private whereFor(filter: CampaignListFilter): Prisma.CampaignWhereInput {
    const where: Prisma.CampaignWhereInput = {};
    if (!filter.isAdmin || !filter.all) where.status = { not: "DRAFT" };
    if (filter.status) where.status = filter.status;
    if (filter.category) where.category = filter.category;
    if (filter.featured) where.featured = true;

    const or: Prisma.CampaignWhereInput[] = [];
    if (filter.urgentOnly) {
      // Only appeals whose deadline has not passed (auto-expire).
      where.urgent = true;
      or.push({ urgentUntil: null }, { urgentUntil: { gt: new Date() } });
    }
    if (filter.q) {
      or.push(
        { title: { contains: filter.q, mode: "insensitive" } },
        { tagline: { contains: filter.q, mode: "insensitive" } },
        { description: { contains: filter.q, mode: "insensitive" } }
      );
    }
    if (or.length > 0) where.OR = or;
    return where;
  }

  async list(filter: CampaignListFilter): Promise<CampaignRow[]> {
    const where = this.whereFor(filter);
    return db.campaign.findMany({ where });
  }

  async supporterCounts(ids: string[]): Promise<SupporterCountRow[]> {
    if (!ids.length) return [];
    const rows = await db.donation.groupBy({
      by: ["campaignId"],
      where: { paymentStatus: "COMPLETED", campaignId: { in: ids } },
      _count: { _all: true },
    });
    return rows;
  }

  async trendVolume(ids: string[], since: Date): Promise<TrendVolumeRow[]> {
    if (!ids.length) return [];
    const rows = await db.donation.groupBy({
      by: ["campaignId"],
      where: {
        paymentStatus: "COMPLETED",
        campaignId: { in: ids },
        createdAt: { gte: since },
      },
      _sum: { amount: true },
    });
    return rows;
  }

  async findById(id: string): Promise<CampaignRow | null> {
    return db.campaign.findUnique({ where: { id } });
  }

  async findBySlug(slug: string): Promise<CampaignRow | null> {
    return db.campaign.findUnique({ where: { slug } });
  }

  async findSlugConflict(slug: string, excludeId: string): Promise<CampaignRow | null> {
    return db.campaign.findFirst({
      where: { slug, id: { not: excludeId } },
    });
  }

  async countCompletedDonations(campaignId: string): Promise<number> {
    return db.donation.count({
      where: { paymentStatus: "COMPLETED", campaignId },
    });
  }

  async create(data: Prisma.CampaignUncheckedCreateInput): Promise<CampaignRow> {
    // code (UAR-CMP-…) and slug are unique — mapped at the boundary.
    return mapPrismaError(() => db.campaign.create({ data }));
  }

  async update(id: string, data: Prisma.CampaignUncheckedUpdateInput): Promise<CampaignRow> {
    // slug is unique (conflicts are pre-checked; a race still maps to 409).
    return mapPrismaError(() => db.campaign.update({ where: { id }, data }));
  }

  async unlinkDonations(campaignId: string): Promise<number> {
    const result = await db.donation.updateMany({
      where: { campaignId },
      data: { campaignId: null },
    });
    return result.count;
  }

  async remove(id: string): Promise<void> {
    await mapPrismaError(() => db.campaign.delete({ where: { id } }));
  }
}
