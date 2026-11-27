/**
 * Public-stats service — the public, privacy-safe food security aggregate
 * behind GET /api/food/public. Every figure is computed from real platform
 * data at request time (repository reads in the exact legacy sequence) —
 * nothing is hardcoded, no beneficiary-level information leaves the server.
 */
import type { FoodPublicRepository } from "../repositories/food-public.repository.interface";

export class PublicStatsService {
  constructor(private readonly publicRepository: FoodPublicRepository) {}

  /** GET /api/food/public — aggregate stats + reporting metadata. */
  async stats(): Promise<unknown> {
    const raw = await this.publicRepository.loadPublicStats();

    return {
      stats: {
        familiesSupported: raw.uniqueHouseholds.length,
        individualsReached: raw.uniqueBeneficiaries.length,
        kitsDistributed: raw.distributedAgg._sum.unitsDelivered ?? 0,
        mealsServed: raw.mealRegs._sum.unitsDelivered ?? 0,
        legacyFoodHandovers: raw.legacyHandovers._count._all,
        distributionLocations: raw.eventCities.length,
        eventsCompleted: raw.completedEvents,
        eventsOpen: raw.openEvents,
        activeProgrammes: raw.activeProgrammes,
        activeVolunteers: raw.volunteerCount.length,
        totalDonations: raw.donationAgg._sum.amount ?? 0,
      },
      reportingPeriod: "All time, since programme launch",
      lastUpdated: raw.lastDistributed?.updatedAt ?? new Date(0),
    };
  }
}
