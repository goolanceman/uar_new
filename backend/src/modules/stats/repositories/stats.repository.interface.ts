/**
 * Stats repository contract — read models for the public /api/stats snapshot.
 * The service layer depends on this interface, never on Prisma directly.
 */
export interface DonationRangeWhere {
  gte?: Date;
  lte?: Date;
}

export interface DonationSumRow {
  _sum: { amount: number | null };
}

export interface KitBatchSumRow {
  _sum: { totalUnits: number | null; scannedUnits: number | null };
}

export interface MissionSumRow {
  _sum: { vehiclesAlerted: number | null; timeSavedSec: number | null };
}

export interface CompletedDonationRow {
  amount: number;
  currency: string;
  category: string;
  donorName: string;
  isAnonymous: boolean;
  createdAt: Date;
  campaign: { title: string } | null;
}

export interface TopCampaignRow {
  title: string;
  raisedAmount: number;
  targetAmount: number;
}

export interface RoleGroupRow {
  role: string;
  _count: { _all: number };
}

export interface DistributionTypeGroupRow {
  type: string;
  _count: { _all: number };
}

export interface PreviousPeriodAggRow {
  _sum: { amount: number | null };
  _count: { _all: number };
}

export interface StatsRepository {
  sumDonations(where: DonationRangeWhere): Promise<DonationSumRow>;
  countDonations(where: DonationRangeWhere): Promise<number>;
  countActiveCampaigns(): Promise<number>;
  countBeneficiaries(): Promise<number>;
  countActiveVolunteers(): Promise<number>;
  countCausesByStatus(status: "SEEKING" | "ADOPTED"): Promise<number>;
  countAnimals(): Promise<number>;
  countAvailableAnimals(): Promise<number>;
  sumKitBatchUnits(): Promise<KitBatchSumRow>;
  countDistributions(): Promise<number>;
  countMissions(): Promise<number>;
  sumMissionImpact(): Promise<MissionSumRow>;
  findCompletedDonations(where: DonationRangeWhere): Promise<CompletedDonationRow[]>;
  findTopCampaigns(): Promise<TopCampaignRow[]>;
  groupUsersByRole(): Promise<RoleGroupRow[]>;
  groupDistributionsByType(): Promise<DistributionTypeGroupRow[]>;
  /** Completed donations in [gte, lt) — the previous equal-length window. */
  sumDonationsInWindow(gte: Date, lt: Date): Promise<PreviousPeriodAggRow>;
}
