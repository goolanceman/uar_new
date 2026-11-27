/**
 * Food insight repository contract — the AI governance reads (event context,
 * forecast/analytics aggregates) and the PENDING AIInteraction audit writes.
 * The service layer depends on this interface, never on Prisma directly.
 */
import type { FoodEvent, InventoryItem } from "@prisma/client";

export type InventoryItemRow = InventoryItem;

/** Event-context include for the `plan` mode (minimised projection). */
export type EventContextRow = FoodEvent & {
  programme: { title: string; category: string };
  packageTemplate: { name: string; items: string } | null;
  registrations: Array<{ status: string; unitsAllocated: number }>;
  allocations: Array<{ status: string; quantity: number }>;
  expenses: Array<{ head: string; amount: number }>;
};

export interface AIInteractionCreateData {
  action: string;
  entityType: string;
  entityId: string | null;
  promptDigest: string;
  outputDigest: string;
  status: string;
}

export interface FoodInsightRepository {
  findEventContext(eventId: string): Promise<EventContextRow | null>;
  /** Full FOOD_KIT inventory rows (plan-mode prompt data). */
  listFoodKitInventory(): Promise<InventoryItemRow[]>;

  // ── forecast aggregates (legacy await structure preserved) ───────────────
  groupRegistrationsByStatus(): Promise<Array<{ status: string; _count: { _all: number }; _sum: { unitsDelivered: number | null } }>>;
  groupEventsByCity(): Promise<Array<{ city: string | null; _count: { _all: number } }>>;
  listStockSummary(): Promise<Array<{ name: string; quantity: number; minStock: number }>>;
  countPendingApplications(): Promise<number>;
  listRecentEvents(): Promise<Array<{
    eventDate: Date; eventType: string; plannedUnits: number;
    city: string | null; status: string; _count: { registrations: number };
  }>>;

  // ── analytics aggregates (legacy await structure preserved) ──────────────
  listDistributedHouseholdIds(): Promise<Array<{ householdId: string | null }>>;
  listDistributedBeneficiaryIds(): Promise<Array<{ beneficiaryId: string }>>;
  aggregateDeliveredUnits(): Promise<{ _sum: { unitsDelivered: number | null } }>;
  listMealEventIds(): Promise<Array<{ id: string }>>;
  countNoShows(): Promise<number>;
  groupEventsByStatus(): Promise<Array<{ status: string; _count: { _all: number } }>>;
  listTopFoodDonors(): Promise<Array<{ donorName: string; amount: number; isAnonymous: boolean }>>;
  groupExpensesByHead(): Promise<Array<{ head: string; _sum: { amount: number | null } }>>;
  listApplicationsCityStatus(): Promise<Array<{ city: string | null; status: string }>>;
  aggregateMealDelivered(eventIds: string[]): Promise<{ _sum: { unitsDelivered: number | null } }>;

  // ── waste mode ───────────────────────────────────────────────────────────
  listActiveBatchesWithItem(): Promise<Array<FoodBatchWithItemSummary>>;
  listInterruptedEvents(): Promise<Array<{ code: string; title: string; eventDate: Date }>>;

  /** Every AI run writes a PENDING AIInteraction (human review required). */
  createAIInteraction(data: AIInteractionCreateData): Promise<void>;
}

export type FoodBatchWithItemSummary = {
  id: string;
  itemId: string;
  batchNo: string;
  quantityReceived: number;
  quantityReserved: number;
  quantityConsumed: number;
  quantityWasted: number;
  quantityReturned: number;
  expiryDate: Date | null;
  qualityStatus: string;
  status: string;
  item: { name: string; unit: string };
};
