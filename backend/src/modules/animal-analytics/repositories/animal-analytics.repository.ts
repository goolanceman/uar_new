/**
 * Prisma implementation of the animal analytics read models — the ONLY place
 * in the animal-analytics module that touches Prisma models directly. All
 * groupBy/aggregate queries live here so the client never crunches raw rows.
 */
import { db } from "@/infrastructure/database/prisma";
import type {
  AnimalAnalyticsRepository,
  AnimalTotalsRow,
  PledgeAggregateRow,
  PledgeKindGroupRow,
  PledgeSumRow,
  PledgeTotalsRow,
  SpeciesGroupRow,
  StatusGroupRow,
} from "./animal-analytics.repository.interface";

export class PrismaAnimalAnalyticsRepository implements AnimalAnalyticsRepository {
  async aggregateAnimals(): Promise<AnimalTotalsRow> {
    return db.animal.aggregate({ _count: { _all: true }, _sum: { monthlyFood: true } });
  }

  async groupAnimalsBySpecies() {
    return db.animal.groupBy({
      by: ["species"],
      _count: { _all: true },
      _sum: { monthlyFood: true },
    });
  }

  async groupAnimalsByStatus() {
    return db.animal.groupBy({ by: ["status"], _count: { _all: true } });
  }

  async countVaccinatedAnimals(): Promise<number> {
    return db.animal.count({ where: { vaccinated: true } });
  }

  async countSterilizedAnimals(): Promise<number> {
    return db.animal.count({ where: { sterilized: true } });
  }

  async aggregatePledges(): Promise<PledgeTotalsRow> {
    return db.animalPledge.aggregate({ _count: { _all: true } });
  }

  async groupPledgesByKind() {
    return db.animalPledge.groupBy({
      by: ["kind"],
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  async groupActivePledgesByKind() {
    return db.animalPledge.groupBy({
      by: ["kind"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  async aggregateActiveMonthlyPledges(): Promise<PledgeAggregateRow> {
    return db.animalPledge.aggregate({
      where: { status: "ACTIVE", frequency: "MONTHLY" },
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  async aggregateActiveOneTimePledges(): Promise<PledgeAggregateRow> {
    return db.animalPledge.aggregate({
      where: { status: "ACTIVE", frequency: "ONE_TIME" },
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  async countShelterFundPledges(): Promise<number> {
    return db.animalPledge.count({ where: { animalId: null } });
  }

  async countActiveShelterFundPledges(): Promise<number> {
    return db.animalPledge.count({ where: { animalId: null, status: "ACTIVE" } });
  }

  async sumActiveMonthlyShelterFund(): Promise<PledgeSumRow> {
    return db.animalPledge.aggregate({
      where: { animalId: null, status: "ACTIVE", frequency: "MONTHLY" },
      _sum: { amount: true },
    });
  }

  async sumActiveOneTimeShelterFund(): Promise<PledgeSumRow> {
    return db.animalPledge.aggregate({
      where: { animalId: null, status: "ACTIVE", frequency: "ONE_TIME" },
      _sum: { amount: true },
    });
  }
}
