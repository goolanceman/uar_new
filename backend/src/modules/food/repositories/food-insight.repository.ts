/**
 * Prisma implementation of the food insight repository — the AI-governance
 * reads (event context, forecast/analytics aggregates) and the PENDING
 * AIInteraction audit writes. Legacy query shapes and await structure are
 * reproduced verbatim.
 */
import { db } from "@/infrastructure/database/prisma";
import type { FoodInsightRepository, AIInteractionCreateData, EventContextRow } from "./food-insight.repository.interface";

export class PrismaFoodInsightRepository implements FoodInsightRepository {
  async findEventContext(eventId: string): Promise<EventContextRow | null> {
    const event = await db.foodEvent.findUnique({
      where: { id: eventId },
      include: {
        programme: { select: { title: true, category: true } },
        packageTemplate: { select: { name: true, items: true } },
        registrations: { select: { status: true, unitsAllocated: true } },
        allocations: { select: { status: true, quantity: true } },
        expenses: { select: { head: true, amount: true } },
      },
    });
    return event as EventContextRow | null;
  }

  async listFoodKitInventory() {
    return db.inventoryItem.findMany({ where: { category: "FOOD_KIT" } });
  }

  // ── forecast aggregates ───────────────────────────────────────────────────

  async groupRegistrationsByStatus() {
    return db.foodRegistration.groupBy({
      by: ["status"],
      _count: { _all: true },
      _sum: { unitsDelivered: true },
    });
  }

  async groupEventsByCity() {
    return db.foodEvent.groupBy({ by: ["city"], _count: { _all: true }, where: { city: { not: null } } });
  }

  async listStockSummary() {
    return db.inventoryItem.findMany({ where: { category: "FOOD_KIT" }, select: { name: true, quantity: true, minStock: true } });
  }

  async countPendingApplications(): Promise<number> {
    return db.beneficiaryRequest.count({ where: { category: "FOOD_ASSISTANCE", status: { in: ["PENDING", "IN_REVIEW"] } } });
  }

  async listRecentEvents() {
    return db.foodEvent.findMany({
      orderBy: { eventDate: "desc" },
      take: 20,
      select: { eventDate: true, eventType: true, plannedUnits: true, city: true, status: true, _count: { select: { registrations: true } } },
    });
  }

  // ── analytics aggregates ──────────────────────────────────────────────────

  async listDistributedHouseholdIds() {
    return db.foodRegistration.findMany({ where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] }, householdId: { not: null } }, distinct: ["householdId"], select: { householdId: true } });
  }

  async listDistributedBeneficiaryIds() {
    return db.foodRegistration.findMany({ where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } }, distinct: ["beneficiaryId"], select: { beneficiaryId: true } });
  }

  async aggregateDeliveredUnits() {
    return db.foodRegistration.aggregate({ where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } }, _sum: { unitsDelivered: true } });
  }

  async listMealEventIds() {
    return db.foodEvent.findMany({ where: { eventType: { in: ["MEAL_SERVING", "KITCHEN"] } }, select: { id: true } });
  }

  async countNoShows(): Promise<number> {
    return db.foodRegistration.count({ where: { status: "NO_SHOW" } });
  }

  async groupEventsByStatus() {
    return db.foodEvent.groupBy({ by: ["status"], _count: { _all: true } });
  }

  async listTopFoodDonors() {
    return db.donation.findMany({ where: { category: "FOOD_DISTRIBUTION", paymentStatus: "COMPLETED" }, orderBy: { amount: "desc" }, take: 10, select: { donorName: true, amount: true, isAnonymous: true } });
  }

  async groupExpensesByHead() {
    return db.foodEventExpense.groupBy({ by: ["head"], _sum: { amount: true } });
  }

  async listApplicationsCityStatus() {
    return db.beneficiaryRequest.findMany({ where: { category: "FOOD_ASSISTANCE" }, select: { city: true, status: true } });
  }

  async aggregateMealDelivered(eventIds: string[]) {
    return db.foodRegistration.aggregate({
      where: { eventId: { in: eventIds }, status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
      _sum: { unitsDelivered: true },
    });
  }

  // ── waste mode ────────────────────────────────────────────────────────────

  async listActiveBatchesWithItem() {
    return db.foodBatch.findMany({
      where: { status: "ACTIVE" },
      include: { item: { select: { name: true, unit: true } } },
    });
  }

  async listInterruptedEvents() {
    return db.foodEvent.findMany({
      where: { status: { in: ["CANCELLED", "POSTPONED", "SUSPENDED"] } },
      select: { code: true, title: true, eventDate: true },
      take: 10,
    });
  }

  // ── AI audit ──────────────────────────────────────────────────────────────

  async createAIInteraction(data: AIInteractionCreateData): Promise<void> {
    await db.aIInteraction.create({ data });
  }
}
