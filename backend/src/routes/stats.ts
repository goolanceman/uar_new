/**
 * Stats routes — /api/stats
 * Converted 1:1 from src/app/api/stats/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { json, handleError } from "@/lib/session";

export const router = Router();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const round2 = (n: number) => Math.round(n * 100) / 100;

function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return round2(((current - previous) / previous) * 100);
}

// GET /api/stats — public aggregate snapshot.
//   ?from=&to= (ISO) → range-scoped giving numbers (raised, donations,
//   monthly, categories, recent) plus deltas vs the previous equal-length
//   period. Without params → all-time defaults (fully backward compatible);
//   `categories` is included in both paths.
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const fromRaw = sp.get("from");
    const toRaw = sp.get("to");
    const from = fromRaw ? new Date(fromRaw) : null;
    const to = toRaw ? new Date(toRaw) : null;
    const hasRange =
      !!from &&
      !!to &&
      !Number.isNaN(from.getTime()) &&
      !Number.isNaN(to.getTime()) &&
      from.getTime() < to.getTime();

    const donationWhere = hasRange
      ? { paymentStatus: "COMPLETED", createdAt: { gte: from!, lte: to! } }
      : { paymentStatus: "COMPLETED" };

    // Previous equal-length window [from - len, from) for cheap deltas
    const prevFrom = hasRange
      ? new Date(from!.getTime() - (to!.getTime() - from!.getTime()))
      : null;

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
      prevAgg,
    ] = await Promise.all([
      db.donation.aggregate({ _sum: { amount: true }, where: donationWhere }),
      db.donation.count({ where: donationWhere }),
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
        where: donationWhere,
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
      }),
      db.campaign.findMany({
        where: { status: { not: "DRAFT" } },
        orderBy: { raisedAmount: "desc" },
        take: 6,
        select: { title: true, raisedAmount: true, targetAmount: true },
      }),
      db.user.groupBy({ by: ["role"], _count: { _all: true } }),
      db.distribution.groupBy({ by: ["type"], _count: { _all: true } }),
      hasRange
        ? db.donation.aggregate({
            _sum: { amount: true },
            _count: { _all: true },
            where: {
              paymentStatus: "COMPLETED",
              createdAt: { gte: prevFrom!, lt: from! },
            },
          })
        : Promise.resolve(null),
    ]);

    /* --------------------------- monthly buckets --------------------------- */

    const now = new Date();
    const monthly: { month: string; amount: number }[] = [];

    if (hasRange) {
      // Monthly buckets inside the requested window, capped at 24 buckets
      // (older windows fall back to the last 24 months ending at `to`).
      const startM = new Date(from!.getFullYear(), from!.getMonth(), 1);
      const endM = new Date(to!.getFullYear(), to!.getMonth(), 1);
      let buckets =
        (endM.getFullYear() - startM.getFullYear()) * 12 +
        (endM.getMonth() - startM.getMonth()) +
        1;
      if (buckets > 24) {
        startM.setMonth(startM.getMonth() + (buckets - 24));
        buckets = 24;
      }
      const withYears = buckets > 12;
      for (let i = 0; i < buckets; i++) {
        const s = new Date(startM.getFullYear(), startM.getMonth() + i, 1);
        const e = new Date(startM.getFullYear(), startM.getMonth() + i + 1, 1);
        const amount = completedDonations
          .filter((d) => d.createdAt >= s && d.createdAt < e)
          .reduce((sum, d) => sum + d.amount, 0);
        monthly.push({
          month: withYears
            ? `${MONTHS[s.getMonth()]} '${String(s.getFullYear()).slice(2)}`
            : MONTHS[s.getMonth()],
          amount: round2(amount),
        });
      }
    } else {
      // Default: last 6 months (legacy shape)
      for (let i = 5; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const amount = completedDonations
          .filter((d) => d.createdAt >= start && d.createdAt < end)
          .reduce((sum, d) => sum + d.amount, 0);
        monthly.push({ month: MONTHS[start.getMonth()], amount: round2(amount) });
      }
    }

    /* ------------------------ category mix (both paths) --------------------- */

    const catMap = new Map<string, number>();
    for (const d of completedDonations) {
      catMap.set(d.category, (catMap.get(d.category) ?? 0) + d.amount);
    }
    const categories = [...catMap.entries()]
      .map(([category, amount]) => ({ category, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount);

    /* ---------------------- per-currency totals (additive) ------------------ */

    // Mixed-currency sums are misleading, so callers can also read the
    // per-currency breakdown. Purely additive — every existing field is
    // unchanged and still sums across currencies as before.
    const curMap = new Map<string, { raised: number; count: number }>();
    for (const d of completedDonations) {
      const key = d.currency || "INR";
      const entry = curMap.get(key) ?? { raised: 0, count: 0 };
      entry.raised += d.amount;
      entry.count += 1;
      curMap.set(key, entry);
    }
    const byCurrency = [...curMap.entries()]
      .map(([currency, v]) => ({ currency, raised: round2(v.raised), count: v.count }))
      .sort((a, b) => b.raised - a.raised);

    /* ------------------------------ deltas ---------------------------------- */

    const rangeRaised = round2(raisedAgg._sum.amount ?? 0);
    const deltas = hasRange
      ? {
          raised: {
            current: rangeRaised,
            previous: round2((prevAgg?._sum.amount as number | undefined) ?? 0),
            pct: pctChange(rangeRaised, (prevAgg?._sum.amount as number | undefined) ?? 0),
          },
          donations: {
            current: donationCount,
            previous: (prevAgg?._count as { _all?: number } | undefined)?._all ?? 0,
            pct: pctChange(
              donationCount,
              (prevAgg?._count as { _all?: number } | undefined)?._all ?? 0
            ),
          },
        }
      : null;

    return json(res, {
      ...(hasRange
        ? {
            range: {
              from: from!.toISOString(),
              to: to!.toISOString(),
              previous: {
                from: prevFrom!.toISOString(),
                to: from!.toISOString(),
              },
            },
            deltas,
          }
        : {}),
      totals: {
        raised: rangeRaised,
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
      categories,
      byCurrency,
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
        currency: d.currency || "INR",
        category: d.category,
        campaign: d.campaign?.title ?? null,
        createdAt: d.createdAt,
      })),
    });
  } catch (e) {
    return handleError(e, res);
  }
});
