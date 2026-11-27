/**
 * Prisma implementation of the stats read models — the ONLY place in the
 * stats module that touches Prisma models directly. All groupBy/aggregate
 * queries live here so the client never crunches raw rows.
 */
import { db } from "@/infrastructure/database/prisma";
import type { Prisma } from "@prisma/client";
import type {
  CompletedDonationRow,
  DonationRangeWhere,
  DonationSumRow,
  DistributionTypeGroupRow,
  KitBatchSumRow,
  MissionSumRow,
  PreviousPeriodAggRow,
  RoleGroupRow,
  StatsRepository,
  TopCampaignRow,
} from "./stats.repository.interface";

/** Completed donations only; optional [gte, lte] createdAt window. */
function donationWhere(range: DonationRangeWhere): Prisma.DonationWhereInput {
  const where: Prisma.DonationWhereInput = { paymentStatus: "COMPLETED" };
  if (range.gte && range.lte) where.createdAt = { gte: range.gte, lte: range.lte };
  return where;
}

export class PrismaStatsRepository implements StatsRepository {
  async sumDonations(where: DonationRangeWhere): Promise<DonationSumRow> {
    return db.donation.aggregate({ _sum: { amount: true }, where: donationWhere(where) });
  }

  async countDonations(where: DonationRangeWhere): Promise<number> {
    return db.donation.count({ where: donationWhere(where) });
  }

  async countActiveCampaigns(): Promise<number> {
    return db.campaign.count({ where: { status: "ACTIVE" } });
  }

  async countBeneficiaries(): Promise<number> {
    return db.beneficiary.count();
  }

  async countActiveVolunteers(): Promise<number> {
    return db.user.count({ where: { role: "VOLUNTEER", status: "ACTIVE" } });
  }

  async countCausesByStatus(status: "SEEKING" | "ADOPTED"): Promise<number> {
    return db.cause.count({ where: { status } });
  }

  async countAnimals(): Promise<number> {
    return db.animal.count();
  }

  async countAvailableAnimals(): Promise<number> {
    return db.animal.count({ where: { status: "AVAILABLE" } });
  }

  async sumKitBatchUnits(): Promise<KitBatchSumRow> {
    return db.kitBatch.aggregate({ _sum: { totalUnits: true, scannedUnits: true } });
  }

  async countDistributions(): Promise<number> {
    return db.distribution.count();
  }

  async countMissions(): Promise<number> {
    return db.mission.count();
  }

  async sumMissionImpact(): Promise<MissionSumRow> {
    return db.mission.aggregate({ _sum: { vehiclesAlerted: true, timeSavedSec: true } });
  }

  async findCompletedDonations(where: DonationRangeWhere): Promise<CompletedDonationRow[]> {
    return db.donation.findMany({
      where: donationWhere(where),
      orderBy: { createdAt: "desc" },
      select: {
        amount: true,
        currency: true,
        category: true,
        donorName: true,
        isAnonymous: true,
        createdAt: true,
        campaign: { select: { title: true } },
      },
    });
  }

  async findTopCampaigns(): Promise<TopCampaignRow[]> {
    return db.campaign.findMany({
      where: { status: { not: "DRAFT" } },
      orderBy: { raisedAmount: "desc" },
      take: 6,
      select: { title: true, raisedAmount: true, targetAmount: true },
    });
  }

  // Return shapes are declared on the interface (campaign-analytics pattern);
  // annotating them here breaks Prisma's groupBy overload resolution.
  async groupUsersByRole() {
    return db.user.groupBy({ by: ["role"], _count: { _all: true } });
  }

  async groupDistributionsByType() {
    return db.distribution.groupBy({ by: ["type"], _count: { _all: true } });
  }

  async sumDonationsInWindow(gte: Date, lt: Date): Promise<PreviousPeriodAggRow> {
    return db.donation.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: {
        paymentStatus: "COMPLETED",
        createdAt: { gte, lt },
      },
    });
  }
}
