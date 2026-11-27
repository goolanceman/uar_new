/**
 * Animal analytics repository contract — read models for the Animal Welfare
 * analytics tab. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface AnimalTotalsRow {
  _count: { _all: number };
  _sum: { monthlyFood: number | null };
}

export interface SpeciesGroupRow {
  species: string;
  _count: { _all: number };
  _sum: { monthlyFood: number | null };
}

export interface StatusGroupRow {
  status: string;
  _count: { _all: number };
}

export interface PledgeTotalsRow {
  _count: { _all: number };
}

export interface PledgeKindGroupRow {
  kind: string;
  _count: { _all: number };
  _sum: { amount: number | null };
}

export interface PledgeAggregateRow {
  _count: { _all: number };
  _sum: { amount: number | null };
}

export interface PledgeSumRow {
  _sum: { amount: number | null };
}

export interface AnimalAnalyticsRepository {
  aggregateAnimals(): Promise<AnimalTotalsRow>;
  groupAnimalsBySpecies(): Promise<SpeciesGroupRow[]>;
  groupAnimalsByStatus(): Promise<StatusGroupRow[]>;
  countVaccinatedAnimals(): Promise<number>;
  countSterilizedAnimals(): Promise<number>;
  aggregatePledges(): Promise<PledgeTotalsRow>;
  groupPledgesByKind(): Promise<PledgeKindGroupRow[]>;
  groupActivePledgesByKind(): Promise<PledgeKindGroupRow[]>;
  aggregateActiveMonthlyPledges(): Promise<PledgeAggregateRow>;
  aggregateActiveOneTimePledges(): Promise<PledgeAggregateRow>;
  countShelterFundPledges(): Promise<number>;
  countActiveShelterFundPledges(): Promise<number>;
  sumActiveMonthlyShelterFund(): Promise<PledgeSumRow>;
  sumActiveOneTimeShelterFund(): Promise<PledgeSumRow>;
}
