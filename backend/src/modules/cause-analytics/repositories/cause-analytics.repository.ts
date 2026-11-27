/**
 * Prisma implementation of the cause analytics read models — the ONLY place
 * in the cause-analytics module that touches Prisma models directly. All
 * groupBy/aggregate queries live here so the client never crunches raw rows.
 */
import { db } from "@/infrastructure/database/prisma";
import type {
  ActivePledgeAggregateRow,
  CauseAnalyticsRepository,
  CauseCityGroupRow,
  CauseConditionGroupRow,
  CauseCostRow,
  CauseStatusGroupRow,
  CauseTotalsRow,
  PledgeInRangeRow,
  PledgeTotalsRow,
  TopCauseRow,
} from "./cause-analytics.repository.interface";

export class PrismaCauseAnalyticsRepository implements CauseAnalyticsRepository {
  async aggregateCauses(): Promise<CauseTotalsRow> {
    return db.cause.aggregate({ _count: { _all: true }, _sum: { raised: true } });
  }

  async groupCausesByStatus() {
    return db.cause.groupBy({ by: ["status"], _count: { _all: true } });
  }

  async groupCausesByCondition() {
    return db.cause.groupBy({
      by: ["condition"],
      _count: { _all: true },
      _sum: { monthlyCost: true },
    });
  }

  async findAllCauseCosts(): Promise<CauseCostRow[]> {
    return db.cause.findMany({ select: { monthlyCost: true, durationMonths: true } });
  }

  async aggregatePledges(): Promise<PledgeTotalsRow> {
    return db.pledge.aggregate({ _count: { _all: true } });
  }

  async aggregateActivePledges(): Promise<ActivePledgeAggregateRow> {
    return db.pledge.aggregate({
      where: { status: "ACTIVE" },
      _count: { _all: true },
      _sum: { amountPerMonth: true },
    });
  }

  async findPledgesInRange(): Promise<PledgeInRangeRow[]> {
    return db.pledge.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 365 * 86_400_000) } },
      select: { amountPerMonth: true, createdAt: true },
    });
  }

  async findTopCauses(): Promise<TopCauseRow[]> {
    return db.cause.findMany({
      orderBy: { raised: "desc" },
      take: 5,
      select: {
        id: true,
        code: true,
        patientName: true,
        status: true,
        raised: true,
        monthlyCost: true,
        durationMonths: true,
      },
    });
  }

  async groupCausesByCity() {
    return db.cause.groupBy({ by: ["city"], _count: { _all: true } });
  }
}
