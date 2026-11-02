import { db } from "@/lib/db";
import { json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// GET /api/stats — public aggregate snapshot
export async function GET() {
  try {
    const [
      raisedAgg,
      donationCount,
      activeCampaigns,
      beneficiaryCount,
      volunteerCount,
      causesSeeking,
      causesAdopted,
      animalCount,
      animalsAvailable,
      kitsAgg,
      distributionCount,
      missionCount,
      missionSums,
      completedDonations,
      campaignTop,
      roleGroups,
      distributionGroups,
    ] = await Promise.all([
      db.donation.aggregate({ _sum: { amount: true }, where: { paymentStatus: "COMPLETED" } }),
      db.donation.count({ where: { paymentStatus: "COMPLETED" } }),
      db.campaign.count({ where: { status: "ACTIVE" } }),
      db.beneficiary.count(),
      db.user.count({ where: { role: "VOLUNTEER", status: "ACTIVE" } }),
      db.cause.count({ where: { status: "SEEKING" } }),
      db.cause.count({ where: { status: "ADOPTED" } }),
      db.animal.count(),
      db.animal.count({ where: { status: "AVAILABLE" } }),
      db.kitBatch.aggregate({ _sum: { totalUnits: true, scannedUnits: true } }),
      db.distribution.count(),
      db.mission.count(),
      db.mission.aggregate({ _sum: { vehiclesAlerted: true, timeSavedSec: true } }),
      db.donation.findMany({
        where: { paymentStatus: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        include: { campaign: { select: { title: true } } },
      }),
      db.campaign.findMany({
        where: { status: { not: "DRAFT" } },
        orderBy: { raisedAmount: "desc" },
        take: 6,
        select: { title: true, raisedAmount: true, targetAmount: true },
      }),
      db.user.groupBy({ by: ["role"], _count: { _all: true } }),
      db.distribution.groupBy({ by: ["type"], _count: { _all: true } }),
    ]);

    // Monthly giving — last 6 months, computed in JS
    const now = new Date();
    const monthly: { month: string; amount: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const amount = completedDonations
        .filter((d) => d.createdAt >= start && d.createdAt < end)
        .reduce((sum, d) => sum + d.amount, 0);
      monthly.push({ month: MONTHS[start.getMonth()], amount });
    }

    return json({
      totals: {
        raised: raisedAgg._sum.amount ?? 0,
        donations: donationCount,
        campaigns: activeCampaigns,
        beneficiaries: beneficiaryCount,
        volunteers: volunteerCount,
        causesSeeking,
        causesAdopted,
        animals: animalCount,
        animalsAvailable,
        kitsUnits: kitsAgg._sum.totalUnits ?? 0,
        kitsScanned: kitsAgg._sum.scannedUnits ?? 0,
        distributions: distributionCount,
        missions: missionCount,
        vehiclesAlerted: missionSums._sum.vehiclesAlerted ?? 0,
        timeSavedMin: Math.round((missionSums._sum.timeSavedSec ?? 0) / 60),
      },
      monthly,
      byCampaign: campaignTop.map((c) => ({
        title: c.title,
        raised: c.raisedAmount,
        target: c.targetAmount,
      })),
      byRole: roleGroups
        .map((g) => ({ role: g.role, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
      distributionTypes: distributionGroups
        .map((g) => ({ type: g.type, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
      recentDonations: completedDonations.slice(0, 5).map((d) => ({
        donorName: d.isAnonymous ? "Anonymous" : d.donorName,
        amount: d.amount,
        campaign: d.campaign?.title ?? null,
        createdAt: d.createdAt,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
