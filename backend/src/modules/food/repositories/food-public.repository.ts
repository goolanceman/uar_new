/**
 * Prisma implementation of the food public-stats repository — the privacy-
 * safe aggregate reads behind GET /api/food/public. The legacy await
 * structure (9-query Promise.all → meal handover rollup → legacy FOOD
 * handover count → cities + last update Promise.all) is reproduced verbatim.
 */
import { db } from "@/infrastructure/database/prisma";
import { FOOD_PUBLIC_EVENT_STATUSES } from "@/lib/food";
import type { FoodPublicRepository, PublicStatsRaw } from "./food-public.repository.interface";

export class PrismaFoodPublicRepository implements FoodPublicRepository {
  async loadPublicStats(): Promise<PublicStatsRaw> {
    const [distributedAgg, uniqueBeneficiaries, uniqueHouseholds, completedEvents, openEvents, activeProgrammes, volunteerCount, donationAgg, mealEvents] =
      await Promise.all([
        db.foodRegistration.aggregate({
          where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
          _sum: { unitsDelivered: true },
        }),
        db.foodRegistration.findMany({
          where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
          distinct: ["beneficiaryId"],
          select: { beneficiaryId: true },
        }),
        db.foodRegistration.findMany({
          where: {
            status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] },
            householdId: { not: null },
          },
          distinct: ["householdId"],
          select: { householdId: true },
        }),
        db.foodEvent.count({ where: { status: { in: ["COMPLETED", "RECONCILED", "CLOSED"] } } }),
        db.foodEvent.count({ where: { status: "REGISTRATION_OPEN", publicVisible: true } }),
        db.foodProgramme.count({ where: { status: { in: ["PUBLISHED", "ACTIVE"] }, publicVisible: true } }),
        db.volunteerTask.findMany({
          where: { refType: "FOOD_EVENT" },
          distinct: ["volunteerId"],
          select: { volunteerId: true },
        }),
        db.donation.aggregate({
          where: { category: "FOOD_DISTRIBUTION", paymentStatus: "COMPLETED" },
          _sum: { amount: true },
        }),
        db.foodEvent.findMany({
          where: { status: { in: ["COMPLETED", "RECONCILED", "CLOSED"] }, eventType: { in: ["MEAL_SERVING", "KITCHEN"] } },
          select: { id: true },
        }),
      ]);

    // Meals served: handovers at meal-serving events; all other handovers are kits.
    const mealEventIds = new Set(mealEvents.map((e) => e.id));
    const mealRegs = await db.foodRegistration.aggregate({
      where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] }, eventId: { in: Array.from(mealEventIds) } },
      _sum: { unitsDelivered: true },
    });

    // Legacy FOOD distributions (earlier UAR module) are counted separately so
    // the two accounting systems never double-count each other.
    const legacyHandovers = await db.distribution.aggregate({
      where: { type: "FOOD" },
      _count: { _all: true },
    });

    const [eventCities, lastDistributed] = await Promise.all([
      db.foodEvent.findMany({
        where: { status: { in: FOOD_PUBLIC_EVENT_STATUSES }, city: { not: null } },
        distinct: ["city"],
        select: { city: true },
      }),
      db.foodRegistration.findFirst({
        where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
    ]);

    return {
      distributedAgg,
      uniqueBeneficiaries,
      uniqueHouseholds,
      completedEvents,
      openEvents,
      activeProgrammes,
      volunteerCount,
      donationAgg,
      mealRegs,
      legacyHandovers,
      eventCities,
      lastDistributed,
    };
  }
}
