/**
 * Cause analytics service — assembles the consolidated Adopt-a-Medicine
 * analytics payload. No HTTP concerns; the 12-month bucketing, funding
 * totals and response mapping match the legacy route exactly.
 */
import type {
  CauseAnalyticsRepository,
  CauseCityGroupRow,
  CauseConditionGroupRow,
  CauseStatusGroupRow,
} from "../repositories/cause-analytics.repository.interface";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface CauseAnalyticsPayload {
  causes: {
    total: number;
    seeking: number;
    partial: number;
    adopted: number;
    paused: number;
    totalRaised: number;
    totalNeeded: number;
  };
  condition: Array<{ condition: string; count: number; monthlyCost: number }>;
  status: Array<{ status: string; count: number }>;
  monthly: Array<{ label: string; amount: number; count: number }>;
  pledges: {
    total: number;
    active: number;
    monthlyValue: number;
  };
  topCities: Array<{ city: string; count: number }>;
  topCauses: Array<{
    id: string;
    code: string;
    patientName: string;
    status: string;
    raised: number;
    total: number;
    pct: number;
  }>;
}

export class CauseAnalyticsService {
  constructor(private readonly causeAnalyticsRepository: CauseAnalyticsRepository) {}

  async getAnalytics(): Promise<CauseAnalyticsPayload> {
    const [
      causeTotals,
      statusGroups,
      conditionGroups,
      allCauses,
      pledgeTotals,
      activePledgeAgg,
      pledgesInRange,
      topCauses,
      cityGroups,
    ] = await Promise.all([
      this.causeAnalyticsRepository.aggregateCauses(),
      this.causeAnalyticsRepository.groupCausesByStatus(),
      this.causeAnalyticsRepository.groupCausesByCondition(),
      this.causeAnalyticsRepository.findAllCauseCosts(),
      this.causeAnalyticsRepository.aggregatePledges(),
      this.causeAnalyticsRepository.aggregateActivePledges(),
      this.causeAnalyticsRepository.findPledgesInRange(),
      this.causeAnalyticsRepository.findTopCauses(),
      this.causeAnalyticsRepository.groupCausesByCity(),
    ]);

    const statusCount = (status: string) =>
      statusGroups.find((g) => g.status === status)?._count._all ?? 0;

    const totalNeeded = allCauses.reduce(
      (s, c) => s + (c.monthlyCost || 0) * (c.durationMonths || 0),
      0
    );

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
      for (const p of pledgesInRange) {
        const key = `${p.createdAt.getUTCFullYear()}-${String(p.createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
        const i = index.get(key);
        if (i !== undefined) {
          buckets[i].amount += p.amountPerMonth;
          buckets[i].count += 1;
        }
      }
    }

    return {
      causes: {
        total: causeTotals._count._all,
        seeking: statusCount("SEEKING"),
        partial: statusCount("PARTIAL"),
        adopted: statusCount("ADOPTED"),
        paused: statusCount("PAUSED"),
        totalRaised: causeTotals._sum.raised ?? 0,
        totalNeeded,
      },
      condition: conditionGroups
        .map((g: CauseConditionGroupRow) => ({
          condition: g.condition,
          count: g._count._all,
          monthlyCost: g._sum.monthlyCost ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
      status: statusGroups.map((g: CauseStatusGroupRow) => ({ status: g.status, count: g._count._all })),
      monthly: buckets.map((b) => ({ label: b.label, amount: b.amount, count: b.count })),
      pledges: {
        total: pledgeTotals._count._all,
        active: activePledgeAgg._count._all,
        monthlyValue: activePledgeAgg._sum.amountPerMonth ?? 0,
      },
      topCities: cityGroups
        .map((g: CauseCityGroupRow) => ({ city: g.city, count: g._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      topCauses: topCauses.map((c) => {
        const total = (c.monthlyCost || 0) * (c.durationMonths || 0);
        return {
          id: c.id,
          code: c.code,
          patientName: c.patientName,
          status: c.status,
          raised: c.raised,
          total,
          pct: total > 0 ? Math.min(100, Math.round((c.raised / total) * 100)) : 0,
        };
      }),
    };
  }
}
