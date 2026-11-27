/**
 * Prisma implementation of the reports read models — the ONLY place in the
 * reports module that touches Prisma models directly. Every query is copied
 * verbatim from the legacy src/routes/reports.ts handlers (same where
 * clauses, selects, orderBy, take/distinct and Promise.all batching) so the
 * DB side-effect ordering is unchanged.
 */
import { db } from "@/infrastructure/database/prisma";
import type {
  AnimalReportRow,
  CauseReportRow,
  DistributionReportRow,
  DonationReportRow,
  FyDonationRow,
  FyProgrammeRows,
  FoodRows,
  HealthRows,
  OverviewRows,
  RangeRows,
  RawDonationRow,
  ReportRepository,
  SponsorshipCoverageRows,
} from "./report.repository.interface";

/** Healthcare programme donations roll up MEDICAL gifts + the community-health-wellness campaign. */
const HEALTHCARE_CAMPAIGN_SLUG = "community-health-wellness";

/**
 * Legacy createdWhere: attach only the bounds that parsed to valid dates.
 * (parseDay already filters NaN — the re-check is legacy-faithful.)
 */
function createdWhere(
  field: "createdAt" | "distributedAt",
  from: Date | null,
  to: Date | null
): Record<string, unknown> {
  const w: Record<string, unknown> = {};
  const range: Record<string, Date> = {};
  if (from && !Number.isNaN(from.getTime())) range.gte = from;
  if (to && !Number.isNaN(to.getTime())) range.lte = to;
  if (Object.keys(range).length > 0) w[field] = range;
  return w;
}

export class PrismaReportRepository implements ReportRepository {
  /* ══════════════════════ healthcare programme aggregates ══════════════════════ */

  async findHealthRows(from: Date, to: Date): Promise<HealthRows> {
    const range = { gte: from, lte: to };

    const [
      campGroups,
      registrationCount,
      attendanceGroups,
      encounterGroups,
      prescriptionGroups,
      dispenseAgg,
      labGroups,
      labCritical,
      referralGroups,
      followUpGroups,
      followUpOverdue,
      medicalDonationAgg,
      expenseAgg,
    ] = await Promise.all([
      db.medicalCamp.groupBy({ by: ["status"], where: { campDate: range }, _count: { _all: true } }),
      db.campRegistration.count({ where: { createdAt: range } }),
      // No dedicated createdAt on CampAttendance: no-shows never check in, so fall
      // back to the 1:1 registration's createdAt when checkInAt is null.
      db.campAttendance.groupBy({
        by: ["status"],
        where: {
          OR: [{ checkInAt: range }, { checkInAt: null, registration: { createdAt: range } }],
        },
        _count: { _all: true },
      }),
      db.encounter.groupBy({ by: ["status"], where: { createdAt: range }, _count: { _all: true } }),
      db.prescription.groupBy({ by: ["status"], where: { createdAt: range }, _count: { _all: true } }),
      db.medicationDispense.aggregate({
        where: { dispensedAt: range },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      db.diagnosticOrder.groupBy({ by: ["status"], where: { createdAt: range }, _count: { _all: true } }),
      db.diagnosticOrder.count({ where: { critical: true, createdAt: range } }),
      db.medicalReferral.groupBy({ by: ["status"], where: { createdAt: range }, _count: { _all: true } }),
      db.followUp.groupBy({
        by: ["status"],
        where: {
          OR: [
            { status: "PENDING", dueDate: range },
            { status: "MISSED", dueDate: range },
            { status: "DONE", doneAt: range },
          ],
        },
        _count: { _all: true },
      }),
      db.followUp.count({
        where: { status: "PENDING", dueDate: { ...range, lt: new Date() } },
      }),
      db.donation.aggregate({
        where: {
          paymentStatus: "COMPLETED",
          createdAt: range,
          OR: [{ category: "MEDICAL" }, { campaign: { slug: HEALTHCARE_CAMPAIGN_SLUG } }],
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      db.campExpense.aggregate({
        where: { spentAt: range },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      campGroups,
      registrationCount,
      attendanceGroups,
      encounterGroups,
      prescriptionGroups,
      dispenseAgg,
      labGroups,
      labCritical,
      referralGroups,
      followUpGroups,
      followUpOverdue,
      medicalDonationAgg,
      expenseAgg,
    };
  }

  /* ══════════════════════ food programme aggregates ══════════════════════ */

  async findFoodRows(from: Date, to: Date): Promise<FoodRows> {
    const range = { gte: from, lte: to };
    const [
      foodDistAgg,
      foodBenRows,
      kitTemplateCount,
      kitBatchCount,
      kitBatchAgg,
      kitScannedInRange,
      kitReady,
      kitExpired,
      foodItems,
    ] = await Promise.all([
      db.distribution.aggregate({
        where: { type: "FOOD", distributedAt: range },
        _sum: { quantity: true, value: true },
        _count: { _all: true },
      }),
      db.distribution.findMany({
        where: { type: "FOOD", distributedAt: range, beneficiaryId: { not: null } },
        select: { beneficiaryId: true },
        distinct: ["beneficiaryId"],
      }),
      db.kitTemplate.count(),
      db.kitBatch.count(),
      db.kitBatch.aggregate({ _sum: { totalUnits: true, scannedUnits: true } }),
      db.kitUnit.count({ where: { status: "SCANNED", scannedAt: range } }),
      db.kitUnit.count({ where: { status: "READY" } }),
      db.kitUnit.count({ where: { status: "EXPIRED" } }),
      db.inventoryItem.findMany({ where: { category: "FOOD_KIT" }, select: { quantity: true, minStock: true } }),
    ]);
    return {
      foodDistAgg,
      foodBenRows,
      kitTemplateCount,
      kitBatchCount,
      kitBatchAgg,
      kitScannedInRange,
      kitReady,
      kitExpired,
      foodItems,
    };
  }

  /* ══════════════════════ ADMIN range report (phase 1) ══════════════════════ */

  async findRangeRows(from: Date, to: Date, includeRegister: boolean): Promise<RangeRows> {
    const rangeWhere = { createdAt: { gte: from, lte: to } };
    const completedWhere = { paymentStatus: "COMPLETED", ...rangeWhere };
    const receiptedWhere = { paymentStatus: "COMPLETED", receiptNumber: { not: "" }, ...rangeWhere };
    const panWhere = { paymentStatus: "COMPLETED", pan: { not: null }, ...rangeWhere };

    const [
      completedAgg,
      panAgg,
      ineligibleAgg,
      receiptRows,
      distAgg,
      distByType,
      distBeneficiaries,
      padAgg,
      padRows,
      kitBatchAgg,
      kitsScannedInRange,
      causeGroups,
      activePledgeAgg,
      animalGroups,
      animalPledgeCount,
      missionsAgg,
      missionsCompleted,
      corridorEventAgg,
      campaignRows,
      registerRaw,
      volunteerAppGroups,
      beneficiaryGroupsCat,
      beneficiaryGroupsUrg,
      beneficiaryOnboarded,
    ] = await Promise.all([
      db.donation.aggregate({
        where: completedWhere,
        _sum: { amount: true, fees: true },
        _count: { _all: true },
      }),
      db.donation.aggregate({ where: panWhere, _sum: { amount: true }, _count: { _all: true } }),
      db.donation.aggregate({
        where: { paymentMethod: "CASH", amount: { gt: 2000 }, ...rangeWhere },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      db.donation.findMany({
        where: receiptedWhere,
        select: { amount: true, createdAt: true },
      }),
      db.distribution.aggregate({
        where: { distributedAt: { gte: from, lte: to } },
        _sum: { value: true, quantity: true },
        _count: { _all: true },
      }),
      db.distribution.groupBy({
        by: ["type"],
        where: { distributedAt: { gte: from, lte: to } },
        _count: { _all: true },
        _sum: { quantity: true, value: true },
      }),
      db.distribution.findMany({
        where: { distributedAt: { gte: from, lte: to }, beneficiaryId: { not: null } },
        select: { beneficiaryId: true },
        distinct: ["beneficiaryId"],
      }),
      db.padDistribution.aggregate({
        where: { distributionDate: { gte: from, lte: to } },
        _sum: { padsDistributed: true, girlsCount: true },
        _count: { _all: true },
      }),
      db.padDistribution.findMany({
        where: { distributionDate: { gte: from, lte: to } },
        select: { schoolName: true, awarenessSession: true },
      }),
      db.kitBatch.aggregate({ _sum: { totalUnits: true, scannedUnits: true } }),
      db.kitUnit.count({ where: { status: "SCANNED", scannedAt: { gte: from, lte: to } } }),
      db.cause.groupBy({ by: ["status"], _count: { _all: true } }),
      db.pledge.aggregate({ where: { status: "ACTIVE" }, _sum: { amountPerMonth: true }, _count: { _all: true } }),
      db.animal.groupBy({ by: ["status"], _count: { _all: true } }),
      db.animalPledge.count({ where: { status: "ACTIVE" } }),
      db.mission.aggregate({
        where: { createdAt: { gte: from, lte: to } },
        _sum: { vehiclesAlerted: true, timeSavedSec: true },
        _count: { _all: true },
      }),
      db.mission.count({ where: { status: "COMPLETED", createdAt: { gte: from, lte: to } } }),
      db.corridorEvent.aggregate({
        where: { createdAt: { gte: from, lte: to } },
        _count: { _all: true },
        _sum: { vehiclesAlerted: true, timeSavedSec: true },
      }),
      db.campaign.findMany({
        where: { status: { not: "DRAFT" } },
        orderBy: { raisedAmount: "desc" },
        select: {
          id: true,
          title: true,
          category: true,
          status: true,
          raisedAmount: true,
          targetAmount: true,
          beneficiaries: true,
        },
      }),
      includeRegister
        ? db.donation.findMany({
            where: rangeWhere,
            orderBy: { createdAt: "desc" },
            take: 1000,
            select: {
              id: true,
              createdAt: true,
              receiptNumber: true,
              donorName: true,
              donorEmail: true,
              donorPhone: true,
              isAnonymous: true,
              pan: true,
              amount: true,
              fees: true,
              type: true,
              category: true,
              paymentMethod: true,
              paymentStatus: true,
              receiptStatus: true,
              campaignId: true,
              campaign: { select: { title: true } },
            },
          })
        : Promise.resolve([] as RawDonationRow[]),
      db.volunteerApplication.groupBy({ by: ["status"], _count: { _all: true } }),
      db.beneficiary.groupBy({ by: ["category"], _count: { _all: true } }),
      db.beneficiary.groupBy({ by: ["urgencyLevel"], _count: { _all: true } }),
      db.beneficiary.count({ where: { createdAt: { gte: from, lte: to } } }),
    ]);

    return {
      completedAgg,
      panAgg,
      ineligibleAgg,
      receiptRows,
      distAgg,
      distByType,
      distBeneficiaries,
      padAgg,
      padRows,
      kitBatchAgg,
      kitsScannedInRange,
      causeGroups,
      activePledgeAgg,
      animalGroups,
      animalPledgeCount,
      missionsAgg,
      missionsCompleted,
      corridorEventAgg,
      campaignRows,
      registerRaw,
      volunteerAppGroups,
      beneficiaryGroupsCat,
      beneficiaryGroupsUrg,
      beneficiaryOnboarded,
    };
  }

  /* ══════════════════════ ADMIN range report (phase 2) ══════════════════════ */

  async groupCompletedDonationsByCategory(from: Date, to: Date) {
    return db.donation.groupBy({
      by: ["category"],
      where: { paymentStatus: "COMPLETED", createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: { _all: true },
    });
  }

  async groupDonorFirstGifts(emails: string[]) {
    return db.donation.groupBy({
      by: ["donorEmail"],
      where: { paymentStatus: "COMPLETED", donorEmail: { in: emails } },
      _min: { createdAt: true },
    });
  }

  /* ══════════════════════ legacy typed reports ══════════════════════ */

  async findDonationReportRows(from: Date | null, to: Date | null): Promise<DonationReportRow[]> {
    return db.donation.findMany({
      where: createdWhere("createdAt", from, to),
      orderBy: { createdAt: "desc" },
      select: {
        receiptNumber: true,
        donorName: true,
        amount: true,
        paymentStatus: true,
        type: true,
        createdAt: true,
      },
    });
  }

  async findDistributionReportRows(from: Date | null, to: Date | null): Promise<DistributionReportRow[]> {
    return db.distribution.findMany({
      where: createdWhere("distributedAt", from, to),
      select: { type: true, quantity: true, value: true },
    });
  }

  async findCauseReportRows(): Promise<CauseReportRow[]> {
    return db.cause.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        code: true,
        patientName: true,
        condition: true,
        raised: true,
        monthlyCost: true,
        status: true,
      },
    });
  }

  async findAnimalReportRows(): Promise<AnimalReportRow[]> {
    return db.animal.findMany({
      orderBy: { createdAt: "desc" },
      include: { pledges: { select: { amount: true } } },
    });
  }

  async findOverviewRows(from: Date | null, to: Date | null): Promise<OverviewRows> {
    const [completedDonations, distributions, campaignTop, byTypeRaw] = await Promise.all([
      db.donation.findMany({
        where: { paymentStatus: "COMPLETED", ...createdWhere("createdAt", from, to) },
        select: { amount: true, createdAt: true },
      }),
      db.distribution.findMany({
        where: createdWhere("distributedAt", from, to),
        select: { quantity: true, type: true, distributedAt: true },
      }),
      db.campaign.findMany({
        where: { status: { not: "DRAFT" } },
        orderBy: { raisedAmount: "desc" },
        take: 6,
        select: { title: true, raisedAmount: true, targetAmount: true },
      }),
      db.distribution.groupBy({
        by: ["type"],
        _count: { _all: true },
        _sum: { quantity: true },
      }),
    ]);
    return { completedDonations, distributions, campaignTop, byTypeRaw };
  }

  /* ══════════════════════ public FY report ══════════════════════ */

  async findCompletedDonationsInFy(from: Date, to: Date): Promise<FyDonationRow[]> {
    return db.donation.findMany({
      where: {
        paymentStatus: "COMPLETED",
        createdAt: { gte: from, lte: to },
      },
      select: {
        amount: true,
        donorName: true,
        donorEmail: true,
        isAnonymous: true,
        category: true,
        createdAt: true,
      },
    });
  }

  async findDonorEmailsBefore(date: Date): Promise<{ donorEmail: string }[]> {
    return db.donation.findMany({
      where: { paymentStatus: "COMPLETED", createdAt: { lt: date } },
      select: { donorEmail: true },
    });
  }

  async findFyProgrammeRows(): Promise<FyProgrammeRows> {
    const [
      kitAgg,
      padAgg,
      padSessions,
      padSchools,
      missionCount,
      corridorEventCount,
      corridorAgg,
      animalsAvailable,
      animalsAdopted,
      animalPledges,
      causeTotal,
      causeSeeking,
      causeAdopted,
      pledgeAgg,
    ] = await Promise.all([
      db.kitBatch.aggregate({ _sum: { totalUnits: true, scannedUnits: true } }),
      db.padDistribution.aggregate({ _sum: { padsDistributed: true, girlsCount: true } }),
      db.padDistribution.count({ where: { awarenessSession: true } }),
      db.padDistribution.findMany({ select: { schoolName: true }, distinct: ["schoolName"] }),
      db.mission.count(),
      db.corridorEvent.count(),
      db.mission.aggregate({ _sum: { vehiclesAlerted: true, timeSavedSec: true } }),
      db.animal.count({ where: { status: "AVAILABLE" } }),
      db.animal.count({ where: { status: "ADOPTED" } }),
      db.animalPledge.count({ where: { status: "ACTIVE" } }),
      db.cause.count(),
      db.cause.count({ where: { status: { in: ["SEEKING", "PARTIAL"] } } }),
      db.cause.count({ where: { status: "ADOPTED" } }),
      db.pledge.aggregate({ _sum: { amountPerMonth: true }, where: { status: "ACTIVE" } }),
    ]);

    return {
      kitAgg,
      padAgg,
      padSessions,
      padSchools,
      missionCount,
      corridorEventCount,
      corridorAgg,
      animalsAvailable,
      animalsAdopted,
      animalPledges,
      causeTotal,
      causeSeeking,
      causeAdopted,
      pledgeAgg,
    };
  }

  /* ══════════════════════ sponsorship coverage ══════════════════════ */

  async findSponsorshipCoverageRows(): Promise<SponsorshipCoverageRows> {
    const [activeNeeds, sponsorships] = await Promise.all([
      db.recurringNeed.findMany({
        where: { status: "ACTIVE" },
        include: {
          beneficiary: { select: { id: true, name: true, city: true, urgencyLevel: true } },
          item: { select: { name: true, unit: true } },
          sponsorships: { where: { status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true } },
        },
      }),
      db.beneficiarySponsorship.findMany({
        include: { donor: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return { activeNeeds, sponsorships };
  }
}
