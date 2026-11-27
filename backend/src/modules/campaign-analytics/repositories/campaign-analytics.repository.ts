/**
 * Prisma implementation of the campaign analytics read models — the ONLY
 * place in the campaign-analytics module that touches Prisma models
 * directly. All groupBy/aggregate queries live here so the client never
 * crunches raw rows.
 */
import { db } from "@/infrastructure/database/prisma";
import type {
  CampaignAnalyticsRepository,
  CampaignCategoryGroupRow,
  CampaignDonationRow,
  CampaignReachRow,
  CampaignStatusGroupRow,
  CampaignTotalsRow,
  TopCampaignRow,
} from "./campaign-analytics.repository.interface";

export class PrismaCampaignAnalyticsRepository implements CampaignAnalyticsRepository {
  async aggregateCampaigns(): Promise<CampaignTotalsRow> {
    return db.campaign.aggregate({
      _count: { _all: true },
      _sum: { raisedAmount: true, targetAmount: true },
    });
  }

  async groupCampaignsByStatus() {
    return db.campaign.groupBy({ by: ["status"], _count: { _all: true } });
  }

  async groupCampaignsByCategory() {
    return db.campaign.groupBy({
      by: ["category"],
      _count: { _all: true },
      _sum: { raisedAmount: true, targetAmount: true },
    });
  }

  async countFeaturedCampaigns(): Promise<number> {
    return db.campaign.count({ where: { featured: true } });
  }

  async countUrgentCampaigns(): Promise<number> {
    return db.campaign.count({ where: { urgent: true } });
  }

  async aggregateCampaignReach(): Promise<CampaignReachRow> {
    return db.campaign.aggregate({
      _sum: { beneficiaries: true, volunteersEngaged: true },
    });
  }

  async findTopCampaigns(): Promise<TopCampaignRow[]> {
    return db.campaign.findMany({
      orderBy: { raisedAmount: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        raisedAmount: true,
        targetAmount: true,
      },
    });
  }

  async findMonthlyDonations(): Promise<CampaignDonationRow[]> {
    return db.donation.findMany({
      where: {
        campaignId: { not: null },
        paymentStatus: "COMPLETED",
        createdAt: { gte: new Date(Date.now() - 365 * 86_400_000) },
      },
      select: { amount: true, createdAt: true },
    });
  }
}
