/**
 * Campaign analytics repository contract — read models for the Campaigns
 * analytics tab. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface CampaignTotalsRow {
  _count: { _all: number };
  _sum: { raisedAmount: number | null; targetAmount: number | null };
}

export interface CampaignStatusGroupRow {
  status: string;
  _count: { _all: number };
}

export interface CampaignCategoryGroupRow {
  category: string;
  _count: { _all: number };
  _sum: { raisedAmount: number | null; targetAmount: number | null };
}

export interface CampaignReachRow {
  _sum: { beneficiaries: number | null; volunteersEngaged: number | null };
}

export interface TopCampaignRow {
  id: string;
  title: string;
  status: string;
  raisedAmount: number;
  targetAmount: number;
}

export interface CampaignDonationRow {
  amount: number;
  createdAt: Date;
}

export interface CampaignAnalyticsRepository {
  aggregateCampaigns(): Promise<CampaignTotalsRow>;
  groupCampaignsByStatus(): Promise<CampaignStatusGroupRow[]>;
  groupCampaignsByCategory(): Promise<CampaignCategoryGroupRow[]>;
  countFeaturedCampaigns(): Promise<number>;
  countUrgentCampaigns(): Promise<number>;
  aggregateCampaignReach(): Promise<CampaignReachRow>;
  findTopCampaigns(): Promise<TopCampaignRow[]>;
  findMonthlyDonations(): Promise<CampaignDonationRow[]>;
}
