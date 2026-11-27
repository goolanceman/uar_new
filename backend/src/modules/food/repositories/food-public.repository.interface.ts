/**
 * Food public-stats repository contract — the privacy-safe aggregate reads
 * behind GET /api/food/public. The service layer depends on this interface,
 * never on Prisma directly.
 */
export interface PublicStatsRaw {
  distributedAgg: { _sum: { unitsDelivered: number | null } };
  uniqueBeneficiaries: Array<{ beneficiaryId: string }>;
  uniqueHouseholds: Array<{ householdId: string | null }>;
  completedEvents: number;
  openEvents: number;
  activeProgrammes: number;
  volunteerCount: Array<{ volunteerId: string }>;
  donationAgg: { _sum: { amount: number | null } };
  mealRegs: { _sum: { unitsDelivered: number | null } };
  legacyHandovers: { _count: { _all: number } };
  eventCities: Array<{ city: string | null }>;
  lastDistributed: { updatedAt: Date } | null;
}

export interface FoodPublicRepository {
  /** Runs the exact legacy read sequence (9-query Promise.all → meal
   *  handovers → legacy FOOD handovers → cities + last update) and returns
   *  the raw aggregate pieces for the service to project. */
  loadPublicStats(): Promise<PublicStatsRaw>;
}
