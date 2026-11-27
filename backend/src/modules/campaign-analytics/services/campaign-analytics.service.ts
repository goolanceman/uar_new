/**
 * Campaign analytics service — assembles the consolidated Campaigns
 * analytics payload. No HTTP concerns; the 12-month bucketing and response
 * mapping match the legacy route exactly.
 */
import type {
  CampaignAnalyticsRepository,
  CampaignCategoryGroupRow,
  CampaignStatusGroupRow,
} from "../repositories/campaign-analytics.repository.interface";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface CampaignAnalyticsPayload {
  campaigns: {
    total: number;
    draft: number;
    active: number;
    paused: number;
    completed: number;
    cancelled: number;
    featured: number;
    urgent: number;
    totalRaised: number;
    totalTarget: number;
  };
  category: Array<{ category: string; count: number; raised: number; target: number }>;
  status: Array<{ status: string; count: number }>;
  monthly: Array<{ label: string; amount: number; count: number }>;
  topCampaigns: Array<{
    id: string;
    title: string;
    status: string;
    raised: number;
    target: number;
    pct: number;
  }>;
  reach: {
    beneficiaries: number;
    volunteersEngaged: number;
  };
}

export class CampaignAnalyticsService {
  constructor(private readonly campaignAnalyticsRepository: CampaignAnalyticsRepository) {}

  async getAnalytics(): Promise<CampaignAnalyticsPayload> {
    const [
      totals,
      statusGroups,
      categoryGroups,
      featuredCount,
      urgentCount,
      reachAgg,
      topCampaigns,
      monthlyDonations,
    ] = await Promise.all([
      this.campaignAnalyticsRepository.aggregateCampaigns(),
      this.campaignAnalyticsRepository.groupCampaignsByStatus(),
      this.campaignAnalyticsRepository.groupCampaignsByCategory(),
      this.campaignAnalyticsRepository.countFeaturedCampaigns(),
      this.campaignAnalyticsRepository.countUrgentCampaigns(),
      this.campaignAnalyticsRepository.aggregateCampaignReach(),
      this.campaignAnalyticsRepository.findTopCampaigns(),
      this.campaignAnalyticsRepository.findMonthlyDonations(),
    ]);

    const statusCount = (status: string) =>
      statusGroups.find((g) => g.status === status)?._count._all ?? 0;

    /* ---- last 12 calendar months, oldest → newest ---- */
    const now = new Date();
    const buckets: { key: string; label: string; amount: number; count: number }[] = [];
    {
      const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
      for (let i = 0; i < 12; i++) {
        const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
        buckets.push({
          key,
          label: `${MONTHS[cursor.getUTCMonth()]} ${String(cursor.getUTCFullYear()).slice(2)}`,
          amount: 0,
          count: 0,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      const index = new Map(buckets.map((b, i) => [b.key, i]));
      for (const d of monthlyDonations) {
        const key = `${d.createdAt.getUTCFullYear()}-${String(d.createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
        const i = index.get(key);
        if (i !== undefined) {
          buckets[i].amount += d.amount;
          buckets[i].count += 1;
        }
      }
    }

    return {
      campaigns: {
        total: totals._count._all,
        draft: statusCount("DRAFT"),
        active: statusCount("ACTIVE"),
        paused: statusCount("PAUSED"),
        completed: statusCount("COMPLETED"),
        cancelled: statusCount("CANCELLED"),
        featured: featuredCount,
        urgent: urgentCount,
        totalRaised: totals._sum.raisedAmount ?? 0,
        totalTarget: totals._sum.targetAmount ?? 0,
      },
      category: categoryGroups
        .map((g: CampaignCategoryGroupRow) => ({
          category: g.category,
          count: g._count._all,
          raised: g._sum.raisedAmount ?? 0,
          target: g._sum.targetAmount ?? 0,
        }))
        .sort((a, b) => b.raised - a.raised),
      status: statusGroups.map((g: CampaignStatusGroupRow) => ({ status: g.status, count: g._count._all })),
      monthly: buckets.map((b) => ({ label: b.label, amount: b.amount, count: b.count })),
      topCampaigns: topCampaigns.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        raised: c.raisedAmount,
        target: c.targetAmount,
        pct: c.targetAmount > 0 ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100)) : 0,
      })),
      reach: {
        beneficiaries: reachAgg._sum.beneficiaries ?? 0,
        volunteersEngaged: reachAgg._sum.volunteersEngaged ?? 0,
      },
    };
  }
}
