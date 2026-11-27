/**
 * Stats service — assembles the public /api/stats snapshot. No HTTP concerns;
 * the range windowing, monthly bucketing and response mapping match the
 * legacy loader exactly, and the snapshot is cached under the same
 * `statsKey(cacheKeyPart({ from, to }) || "all")` key with `cacheTtl.stats`.
 */
import { cached, cacheKeyPart, cacheTtl, statsKey } from "@/infrastructure/cache";
import type {
  CompletedDonationRow,
  DonationRangeWhere,
  PreviousPeriodAggRow,
  StatsRepository,
} from "../repositories/stats.repository.interface";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const round2 = (n: number) => Math.round(n * 100) / 100;

function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return round2(((current - previous) / previous) * 100);
}

export class StatsService {
  constructor(private readonly statsRepository: StatsRepository) {}

  /** GET /api/stats — public aggregate snapshot (?from=&to= → range-scoped). */
  getSnapshot(fromRaw: string | null, toRaw: string | null): Promise<Record<string, unknown>> {
    return cached(statsKey(cacheKeyPart({ from: fromRaw, to: toRaw }) || "all"), cacheTtl.stats, () =>
      this.load(fromRaw, toRaw)
    );
  }

  private async load(fromRaw: string | null, toRaw: string | null) {
    const from = fromRaw ? new Date(fromRaw) : null;
    const to = toRaw ? new Date(toRaw) : null;
    const hasRange =
      !!from &&
      !!to &&
      !Number.isNaN(from.getTime()) &&
      !Number.isNaN(to.getTime()) &&
      from.getTime() < to.getTime();

    const donationWhere: DonationRangeWhere = hasRange ? { gte: from!, lte: to! } : {};

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
      this.statsRepository.sumDonations(donationWhere),
      this.statsRepository.countDonations(donationWhere),
      this.statsRepository.countActiveCampaigns(),
      this.statsRepository.countBeneficiaries(),
      this.statsRepository.countActiveVolunteers(),
      this.statsRepository.countCausesByStatus("SEEKING"),
      this.statsRepository.countCausesByStatus("ADOPTED"),
      this.statsRepository.countAnimals(),
      this.statsRepository.countAvailableAnimals(),
      this.statsRepository.sumKitBatchUnits(),
      this.statsRepository.countDistributions(),
      this.statsRepository.countMissions(),
      this.statsRepository.sumMissionImpact(),
      this.statsRepository.findCompletedDonations(donationWhere),
      this.statsRepository.findTopCampaigns(),
      this.statsRepository.groupUsersByRole(),
      this.statsRepository.groupDistributionsByType(),
      hasRange
        ? this.statsRepository.sumDonationsInWindow(prevFrom!, from!)
        : Promise.resolve(null as PreviousPeriodAggRow | null),
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
    for (const d of completedDonations as CompletedDonationRow[]) {
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
            previous: round2(prevAgg?._sum.amount ?? 0),
            pct: pctChange(rangeRaised, prevAgg?._sum.amount ?? 0),
          },
          donations: {
            current: donationCount,
            previous: prevAgg?._count._all ?? 0,
            pct: pctChange(donationCount, prevAgg?._count._all ?? 0),
          },
        }
      : null;

    return {
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
    };
  }
}
