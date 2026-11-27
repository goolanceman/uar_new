/**
 * Animal analytics service — assembles the consolidated Animal Welfare
 * analytics payload. No HTTP concerns; mapping matches the legacy route
 * exactly (totals by status, species donut, pledge splits, shelter fund).
 */
import type {
  AnimalAnalyticsRepository,
  PledgeKindGroupRow,
  SpeciesGroupRow,
  StatusGroupRow,
} from "../repositories/animal-analytics.repository.interface";

export interface AnimalAnalyticsPayload {
  animals: {
    total: number;
    available: number;
    fostered: number;
    adopted: number;
    critical: number;
    vaccinated: number;
    sterilized: number;
    monthlyFoodCommitment: number;
  };
  species: Array<{ species: string; count: number; monthlyFood: number }>;
  status: Array<{ status: string; count: number }>;
  pledges: {
    total: number;
    active: number;
    monthlyValue: number;
    monthlyCount: number;
    oneTimeValue: number;
    oneTimeCount: number;
    byKind: Array<{
      kind: string;
      count: number;
      amount: number;
      activeCount: number;
      monthlyAmount: number;
    }>;
    shelterFund: {
      count: number;
      activeCount: number;
      monthlyValue: number;
      oneTimeValue: number;
    };
  };
}

export class AnimalAnalyticsService {
  constructor(private readonly animalAnalyticsRepository: AnimalAnalyticsRepository) {}

  async getAnalytics(): Promise<AnimalAnalyticsPayload> {
    const [
      animalTotals,
      speciesGroups,
      statusGroups,
      vaccinatedCount,
      sterilizedCount,
      pledgeTotals,
      pledgeKindAll,
      pledgeKindActive,
      monthlyPledgeAgg,
      oneTimePledgeAgg,
      shelterAll,
      shelterActive,
      shelterMonthlyAgg,
      shelterOneTimeAgg,
    ] = await Promise.all([
      this.animalAnalyticsRepository.aggregateAnimals(),
      this.animalAnalyticsRepository.groupAnimalsBySpecies(),
      this.animalAnalyticsRepository.groupAnimalsByStatus(),
      this.animalAnalyticsRepository.countVaccinatedAnimals(),
      this.animalAnalyticsRepository.countSterilizedAnimals(),
      this.animalAnalyticsRepository.aggregatePledges(),
      this.animalAnalyticsRepository.groupPledgesByKind(),
      this.animalAnalyticsRepository.groupActivePledgesByKind(),
      this.animalAnalyticsRepository.aggregateActiveMonthlyPledges(),
      this.animalAnalyticsRepository.aggregateActiveOneTimePledges(),
      this.animalAnalyticsRepository.countShelterFundPledges(),
      this.animalAnalyticsRepository.countActiveShelterFundPledges(),
      this.animalAnalyticsRepository.sumActiveMonthlyShelterFund(),
      this.animalAnalyticsRepository.sumActiveOneTimeShelterFund(),
    ]);

    const statusCount = (rows: Array<StatusGroupRow>, key: string) =>
      rows.find((r) => r.status === key)?._count._all ?? 0;

    const kinds = ["FOOD", "MEDICAL", "VACCINATION", "SHELTER"] as const;
    const byKind = kinds.map((kind) => {
      const all: PledgeKindGroupRow | undefined = pledgeKindAll.find((k) => k.kind === kind);
      const active: PledgeKindGroupRow | undefined = pledgeKindActive.find((k) => k.kind === kind);
      return {
        kind,
        count: all?._count._all ?? 0,
        amount: all?._sum.amount ?? 0,
        activeCount: active?._count._all ?? 0,
        monthlyAmount: active?._sum.amount ?? 0,
      };
    });

    return {
      animals: {
        total: animalTotals._count._all,
        available: statusCount(statusGroups, "AVAILABLE"),
        fostered: statusCount(statusGroups, "FOSTERED"),
        adopted: statusCount(statusGroups, "ADOPTED"),
        critical: statusCount(statusGroups, "CRITICAL"),
        vaccinated: vaccinatedCount,
        sterilized: sterilizedCount,
        monthlyFoodCommitment: animalTotals._sum.monthlyFood ?? 0,
      },
      species: speciesGroups
        .map((g: SpeciesGroupRow) => ({
          species: g.species,
          count: g._count._all,
          monthlyFood: g._sum.monthlyFood ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
      status: statusGroups.map((g: StatusGroupRow) => ({
        status: g.status,
        count: g._count._all,
      })),
      pledges: {
        total: pledgeTotals._count._all,
        active: monthlyPledgeAgg._count._all + oneTimePledgeAgg._count._all,
        monthlyValue: monthlyPledgeAgg._sum.amount ?? 0,
        monthlyCount: monthlyPledgeAgg._count._all,
        oneTimeValue: oneTimePledgeAgg._sum.amount ?? 0,
        oneTimeCount: oneTimePledgeAgg._count._all,
        byKind,
        shelterFund: {
          count: shelterAll,
          activeCount: shelterActive,
          monthlyValue: shelterMonthlyAgg._sum.amount ?? 0,
          oneTimeValue: shelterOneTimeAgg._sum.amount ?? 0,
        },
      },
    };
  }
}
