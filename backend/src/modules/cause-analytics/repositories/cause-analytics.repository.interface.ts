/**
 * Cause analytics repository contract — read models for the Adopt-a-Medicine
 * analytics tab. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface CauseTotalsRow {
  _count: { _all: number };
  _sum: { raised: number | null };
}

export interface CauseStatusGroupRow {
  status: string;
  _count: { _all: number };
}

export interface CauseConditionGroupRow {
  condition: string;
  _count: { _all: number };
  _sum: { monthlyCost: number | null };
}

export interface CauseCostRow {
  monthlyCost: number;
  durationMonths: number;
}

export interface PledgeTotalsRow {
  _count: { _all: number };
}

export interface ActivePledgeAggregateRow {
  _count: { _all: number };
  _sum: { amountPerMonth: number | null };
}

export interface PledgeInRangeRow {
  amountPerMonth: number;
  createdAt: Date;
}

export interface TopCauseRow {
  id: string;
  code: string;
  patientName: string;
  status: string;
  raised: number;
  monthlyCost: number;
  durationMonths: number;
}

export interface CauseCityGroupRow {
  city: string;
  _count: { _all: number };
}

export interface CauseAnalyticsRepository {
  aggregateCauses(): Promise<CauseTotalsRow>;
  groupCausesByStatus(): Promise<CauseStatusGroupRow[]>;
  groupCausesByCondition(): Promise<CauseConditionGroupRow[]>;
  findAllCauseCosts(): Promise<CauseCostRow[]>;
  aggregatePledges(): Promise<PledgeTotalsRow>;
  aggregateActivePledges(): Promise<ActivePledgeAggregateRow>;
  findPledgesInRange(): Promise<PledgeInRangeRow[]>;
  findTopCauses(): Promise<TopCauseRow[]>;
  groupCausesByCity(): Promise<CauseCityGroupRow[]>;
}
