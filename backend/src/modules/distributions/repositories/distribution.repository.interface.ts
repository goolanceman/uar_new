/**
 * Distribution repository contract — distribution rows, the volunteer /
 * campaign / recurring-need lookups and the stock-effect write operations.
 * The service layer depends on this interface, never on Prisma directly.
 *
 * Transactional methods accept an optional `client` (Prisma.TransactionClient)
 * so the service can run multi-step stock flows inside ONE
 * withTransaction boundary — repositories never obtain clients themselves.
 */
import type { Campaign, Distribution, InventoryDistribution, InventoryItem, KitBatch, KitTemplate, Prisma, RecurringNeed, Volunteer } from "@prisma/client";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";

export type DistributionRow = Distribution;
export type VolunteerRow = Volunteer;

/** GET / list shape — legacy INCLUDE (beneficiary summary + volunteer with user name). */
export type DistributionListRow = Distribution & {
  beneficiary: {
    id: string;
    name: string;
    category: string;
    urgencyLevel: string;
    city: string | null;
    familyMembers: number;
  } | null;
  volunteer: (Volunteer & { user: { name: string } }) | null;
};

/** GET /:id detail — adds inventory lines and the kit batch + template. */
export type DistributionDetailRow = Distribution & {
  beneficiary: DistributionListRow["beneficiary"];
  volunteer: (Volunteer & { user: { name: string } }) | null;
  inventoryDistributions: (InventoryDistribution & { item: InventoryItem })[];
  kitBatch: (KitBatch & { template: KitTemplate }) | null;
};

export type CampaignSummary = Pick<
  Campaign,
  "id" | "title" | "accent" | "status" | "targetAmount" | "raisedAmount"
>;

export type RecurringNeedSummary = Pick<RecurringNeed, "id" | "beneficiaryId" | "cycle">;

/** assertCanMutate read shape (id/volunteerId/type/quantity only). */
export type DistributionMutateSummary = Pick<
  Distribution,
  "id" | "volunteerId" | "type" | "quantity"
>;

export interface DistributionListFilters {
  /** raw strings — the repository applies the legacy trim/truthy semantics */
  type?: string;
  q?: string;
  from?: string;
  to?: string;
  volunteerId?: string;
  beneficiaryId?: string;
  campaignId?: string;
  kitBatchId?: string;
  itemId?: string;
  /** set only when ?mine was present and the volunteer profile resolved */
  mineVolunteerId?: string;
}

export interface DistributionCreateData {
  type: string;
  beneficiaryId: string | null;
  campaignId: string | null;
  volunteerId: string | null;
  items: string | null;
  quantity: number;
  value: number | null;
  photos: string | null;
  location: string;
  notes: string | null;
  distributedAt: Date;
  kitBatchId?: string;
  kitQuantity?: number;
  recurringNeedId?: string;
}

export interface DistributionUpdateData {
  type?: string;
  beneficiaryId?: string | null;
  campaignId?: string | null;
  volunteerId?: string | null;
  quantity?: number;
  value?: number | null;
  location?: string;
  notes?: string | null;
  distributedAt?: Date;
  items?: string | null;
  kitBatchId?: string | null;
  kitQuantity?: number | null;
}

export interface DistributionRepository {
  findVolunteerByUserId(userId: string): Promise<VolunteerRow | null>;
  findVolunteerById(id: string): Promise<VolunteerRow | null>;
  findRecurringNeedById(id: string): Promise<RecurringNeedSummary | null>;

  listDistributions(
    filters: DistributionListFilters,
    limit: number,
    offset: number
  ): Promise<DistributionListRow[]>;
  countDistributions(filters: DistributionListFilters): Promise<number>;
  findCampaignsByIds(ids: string[]): Promise<CampaignSummary[]>;
  /** withTotals=1 aggregates (all keyed off the same legacy where). */
  aggregateTotals(filters: DistributionListFilters): Promise<{ value: number | null; quantity: number | null }>;
  listServedBeneficiaryIds(filters: DistributionListFilters): Promise<{ beneficiaryId: string | null }[]>;
  listItemRows(filters: DistributionListFilters): Promise<{ items: string | null }[]>;

  findDistributionDetail(id: string): Promise<DistributionDetailRow | null>;
  findDistributionForMutate(id: string): Promise<DistributionMutateSummary | null>;

  /** beneficiaryId/kitBatchId/recurringNeedId are FKs — constraint failures
   *  render as conflicts. Pass `client` to join the caller's transaction. */
  createDistribution(
    data: DistributionCreateData,
    client?: DbClient
  ): Promise<DistributionRow>;
  updateDistribution(
    id: string,
    data: DistributionUpdateData,
    client?: DbClient
  ): Promise<DistributionRow>;
  deleteDistribution(id: string, client?: DbClient): Promise<void>;
  updateRecurringNeed(
    id: string,
    data: { lastFulfilledAt: Date; nextDueAt: Date },
    client?: DbClient
  ): Promise<void>;
}

/** Narrow Prisma transaction-client type for internal casts. */
export type Tx = Prisma.TransactionClient;
