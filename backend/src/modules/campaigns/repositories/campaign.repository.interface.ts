/**
 * Campaign repository contract — persistence for campaigns and the donation
 * aggregates the public projections need. The service layer depends on this
 * interface, never on Prisma directly.
 */
import type { Campaign, Prisma } from "@prisma/client";

export type CampaignRow = Campaign;

/** Filters for the public/admin list — already parsed from the query string. */
export interface CampaignListFilter {
  isAdmin: boolean;
  all: boolean;
  category: string | null;
  status: string | null;
  q: string | undefined;
  featured: boolean;
  urgentOnly: boolean;
}

/** One row of the supporter-count groupBy (distinct completed donations). */
export interface SupporterCountRow {
  campaignId: string | null;
  _count: { _all: number };
}

/** One row of the trending groupBy (completed donation volume in a window). */
export interface TrendVolumeRow {
  campaignId: string | null;
  _sum: { amount: number | null };
}

export interface CampaignRepository {
  /** Filtered list (admin `all` keeps DRAFT rows) — full rows, no ordering. */
  list(filter: CampaignListFilter): Promise<CampaignRow[]>;

  /** Distinct completed donations per campaign — the "N supporters" figure. */
  supporterCounts(ids: string[]): Promise<SupporterCountRow[]>;
  /** Completed donation volume since `since` — the trending score. */
  trendVolume(ids: string[], since: Date): Promise<TrendVolumeRow[]>;

  findById(id: string): Promise<CampaignRow | null>;
  findBySlug(slug: string): Promise<CampaignRow | null>;
  /** Slug conflict check for the PATCH edit path (excludes the row itself). */
  findSlugConflict(slug: string, excludeId: string): Promise<CampaignRow | null>;
  /** Completed donations for one campaign (detail donorCount). */
  countCompletedDonations(campaignId: string): Promise<number>;

  create(data: Prisma.CampaignUncheckedCreateInput): Promise<CampaignRow>;
  update(id: string, data: Prisma.CampaignUncheckedUpdateInput): Promise<CampaignRow>;
  /** Legacy delete detaches donations first (donations kept, unlinked). */
  unlinkDonations(campaignId: string): Promise<number>;
  remove(id: string): Promise<void>;
}
