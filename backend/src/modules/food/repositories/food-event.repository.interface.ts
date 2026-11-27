/**
 * Food event repository contract — FoodEvent rows, the event-detail
 * projection (registrations/allocations/expenses) and the event-context
 * lookups (campaign, kit template). The service layer depends on this
 * interface, never on Prisma directly. Transactional methods accept the
 * caller's `client` (withTransaction boundary) — repositories never obtain
 * clients themselves.
 */
import type {
  Campaign,
  FoodEvent,
  FoodEventExpense,
  FoodRegistration,
  FoodStockAllocation,
  KitTemplate,
} from "@prisma/client";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";

export type FoodEventRow = FoodEvent;
export type CampaignRow = Campaign;
export type KitTemplateRow = KitTemplate;
export type FoodEventExpenseRow = FoodEventExpense;

/** GET /events?public=1 — safe-field list include (programme + live reg count
 *  excluding cancelled/rejected). */
export type PublicEventRow = FoodEvent & {
  programme: { title: string; slug: string; category: string; eligibilityCriteria: string | null } | null;
  _count: { registrations: number };
};

/** GET /events?mine=1 — a beneficiary's registrations with the event summary. */
export type MyRegistrationRow = FoodRegistration & {
  event: {
    id: string; code: string; title: string; eventDate: Date;
    startTime: string | null; endTime: string | null; venue: string;
    city: string | null; status: string; eventType: string;
  } & { programme: { title: string } | null };
};

/** Admin event list include (programme summary + registration count). */
export type AdminEventRow = FoodEvent & {
  programme: { id: string; title: string; category: string } | null;
  _count: { registrations: number };
};

/** Event detail registration include (beneficiary/household/checkIn summary). */
export type EventDetailRegistration = FoodRegistration & {
  beneficiary: {
    id: string; code: string; name: string; phone: string | null;
    city: string | null; category: string; familyMembers: number;
  };
  household: { id: string; code: string; name: string; size: number } | null;
  checkIn: { method: string; checkedInAt: Date; operatorName: string | null } | null;
};

/** GET /events/:id — the operations-brain projection (lifecycle, requirements
 *  vs stock, allocations, registration counts, expenses). */
export type EventDetailRow = FoodEvent & {
  programme: { id: string; code: string; title: string; category: string };
  campaign: { id: string; title: string } | null;
  packageTemplate: KitTemplate | null;
  registrations: EventDetailRegistration[];
  allocations: (FoodStockAllocation & {
    batch: { id: string; batchNo: string; expiryDate: Date | null; qualityStatus: string; source: string };
    item: { id: string; name: string; unit: string };
  })[];
  expenses: FoodEventExpense[];
  _count: { registrations: number };
};

export interface EventListFilters {
  status?: string | null;
  programmeId?: string | null;
  city?: string | null;
  q?: string | null;
}

export interface EventCreateData {
  code: string;
  programmeId: string;
  campaignId: string | null;
  title: string;
  description: string | null;
  eventDate: Date;
  startTime: string | null;
  endTime: string | null;
  venue: string;
  city: string | null;
  address: string | null;
  eventType: string;
  packageTemplateId: string | null;
  plannedUnits: number;
  maxCapacity: number | null;
  coordinatorName: string | null;
  registrationDeadline: Date | null;
  registrationOpen: boolean;
  publicVisible: boolean;
  specialInstructions: string | null;
  budget: number | null;
  createdByName: string;
}

/** PATCH field patch — keys exist only when the legacy handler set them
 *  (the service builds it with the exact same conditional writes). */
export interface EventUpdateData {
  title?: string;
  description?: string | null;
  eventDate?: Date;
  startTime?: string | null;
  endTime?: string | null;
  venue?: string;
  city?: string | null;
  address?: string | null;
  coordinatorName?: string | null;
  registrationDeadline?: Date | null;
  registrationOpen?: boolean;
  publicVisible?: boolean;
  specialInstructions?: string | null;
  plannedUnits?: number;
  maxCapacity?: number | null;
  budget?: number | null;
  packageTemplateId?: string | null;
  status?: string;
  statusReason?: string | null;
}

export interface ExpenseCreateData {
  eventId: string;
  head: string;
  amount: number;
  notes: string | null;
  spentByName: string;
}

export interface FoodEventRepository {
  /** Public-visible events in the public lifecycle statuses (oldest first). */
  listPublicEvents(): Promise<PublicEventRow[]>;
  findEventById(id: string): Promise<FoodEventRow | null>;
  /** Event with its package template (registration/walk-in flows). */
  findEventWithTemplate(id: string): Promise<(FoodEventRow & { packageTemplate: KitTemplateRow | null }) | null>;
  /** A beneficiary's own registrations, newest first (max 50). */
  listMyRegistrations(beneficiaryId: string): Promise<MyRegistrationRow[]>;
  /** Admin list with the legacy filter semantics (raw sp strings). */
  listEvents(filters: EventListFilters): Promise<AdminEventRow[]>;
  /** programmeId/campaignId/packageTemplateId are FKs — constraint failures render as conflicts. */
  createEvent(data: EventCreateData): Promise<FoodEventRow>;
  findEventDetail(id: string): Promise<EventDetailRow | null>;
  /** Joins the caller's withTransaction boundary. */
  updateEvent(id: string, data: EventUpdateData, client: DbClient): Promise<FoodEventRow>;

  /** Event-context lookups (create flow). */
  findCampaignById(id: string): Promise<CampaignRow | null>;
  findKitTemplateById(id: string): Promise<KitTemplateRow | null>;

  listExpenses(eventId: string): Promise<FoodEventExpenseRow[]>;
  /** eventId is an FK — constraint failures render as conflicts. */
  createExpense(data: ExpenseCreateData): Promise<FoodEventExpenseRow>;
}
