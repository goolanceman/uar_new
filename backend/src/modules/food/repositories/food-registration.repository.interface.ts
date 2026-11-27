/**
 * Food registration repository contract — FoodRegistration, FoodCheckIn and
 * the distribution-desk staffing lookups (Volunteer, VolunteerTask). The
 * service layer depends on this interface, never on Prisma directly.
 * Transactional methods accept the caller's `client` (withTransaction
 * boundary) — repositories never obtain clients themselves.
 */
import type {
  Beneficiary,
  FoodCheckIn,
  FoodEvent,
  FoodRegistration,
  Volunteer,
  VolunteerTask,
} from "@prisma/client";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";

export type BeneficiaryRow = Beneficiary;
export type FoodRegistrationRow = FoodRegistration;
export type FoodCheckInRow = FoodCheckIn;
export type VolunteerRow = Volunteer;

/** FREG-code resolution — registration with its full event. */
export type RegistrationWithEvent = FoodRegistration & { event: FoodEvent };

/** Candidate-match include (name/code/phone scan). */
export type RegistrationCandidate = FoodRegistration & {
  event: FoodEvent;
  beneficiary: { code: string; name: string; phone: string | null };
};

/** Offline-replay re-read include. */
export type RegistrationReplayRow = FoodRegistration & {
  beneficiary: { code: string; name: string };
};

/** Post-check-in fresh read include. */
export type RegistrationFreshRow = FoodRegistration & {
  beneficiary: { code: string; name: string; familyMembers: number; city: string | null };
  event: { code: string; title: string; venue: string; packageTemplate: { name: string } | null };
};

/** Checkout claim re-read include. */
export type RegistrationHandoverRow = FoodRegistration & {
  beneficiary: { code: string; name: string };
  event: { code: string; title: string };
};

/** Walk-in duplicate-identity read include. */
export type RegistrationWithBeneficiary = FoodRegistration & {
  beneficiary: { code: string; name: string };
};

/** GET /events/:id — registration list include. */
export type EventRegistrationRow = FoodRegistration & {
  beneficiary: {
    id: string; code: string; name: string; phone: string | null;
    city: string | null; familyMembers: number;
  };
  household: { id: string; code: string; name: string; size: number } | null;
  checkIn: { method: string; checkedInAt: Date; operatorName: string | null } | null;
};

/** GET /registrations — admin queue include. */
export type RegistrationQueueRow = FoodRegistration & {
  beneficiary: { id: string; code: string; name: string; phone: string | null; city: string | null };
  event: { id: string; code: string; title: string; eventDate: Date; status: string };
  checkIn: { method: string; checkedInAt: Date; operatorName: string | null } | null;
};

/** PATCH /registrations/:id lookup include. */
export type RegistrationWithEventSummary = FoodRegistration & {
  event: { code: string; title: string };
};

/** VolunteerTask with the assignee summary (legacy taskInclude). */
export type VolunteerTaskWithVolunteer = VolunteerTask & {
  volunteer: {
    id: string;
    code: string;
    user: { name: string; phone: string | null; email: string };
  };
};

export interface RegistrationCreateData {
  code: string;
  eventId: string;
  beneficiaryId: string;
  householdId: string | null;
  unitsAllocated: number;
  packageSnapshot: string | null;
  status: string;
  registeredVia: string;
  notes: string | null;
  createdByName: string;
}

export interface CheckInCreateData {
  registrationId: string;
  eventId: string;
  method: string;
  operatorId: string;
  operatorName: string;
  offlineRef: string | null;
}

/** Conditional update inside a claim (updateMany) — keys exist only when the
 *  legacy handler set them. */
export interface RegistrationClaimData {
  status?: string;
  unitsDelivered?: number;
  unitsAllocated?: number;
  ackMethod?: string;
  ackByName?: string | null;
  ackRef?: string | null;
  ackAt?: Date;
  reason?: string | null;
  notes?: string | null;
  householdId?: string | null;
}

export interface RegistrationUpdateData {
  unitsAllocated?: number;
  notes?: string | null;
  householdId?: string | null;
  status?: string;
  reason?: string;
}

export interface BeneficiaryCreateData {
  code: string;
  name: string;
  phone: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  category: string;
  urgencyLevel: string;
  familyMembers: number;
  needs: string;
  caseStatus: string;
  onboardedByName: string;
  intakeDate: Date;
}

export interface VolunteerTaskCreateData {
  volunteerId: string;
  title: string;
  description: string;
  type: string;
  location: string;
  scheduledDate: Date;
  refType: string;
  refId: string;
  status: string;
  createdFrom: string;
  notes: string | null;
}

export interface RegistrationQueueFilters {
  eventId?: string | null;
  status?: string | null;
  q?: string | null;
}

export interface FoodRegistrationRepository {
  // ── resolution (check-in desk) ────────────────────────────────────────────
  /** UAR-FREG QR lookup with the full event. */
  findRegistrationByEventCode(code: string): Promise<RegistrationWithEvent | null>;
  /** Legacy candidate scan: UAR-BEN → beneficiary code, 10 digits → phone
   *  contains, else beneficiary name contains; optional event scoping. */
  listRegistrationCandidates(code: string, eventId: string | null): Promise<RegistrationCandidate[]>;
  findCheckInByOfflineRef(offlineRef: string): Promise<FoodCheckInRow | null>;
  findRegistrationReplay(id: string): Promise<RegistrationReplayRow | null>;

  // ── check-in / handover writes (claim semantics) ──────────────────────────
  /** Conditional updateMany (id + expected status) → changed row count. */
  claimRegistration(id: string, fromStatus: string, data: RegistrationClaimData, client: DbClient): Promise<number>;
  createCheckIn(data: CheckInCreateData, client: DbClient): Promise<void>;
  findRegistrationFresh(id: string): Promise<RegistrationFreshRow | null>;
  findRegistrationForHandover(id: string, client: DbClient): Promise<RegistrationHandoverRow>;

  // ── role scoping ──────────────────────────────────────────────────────────
  findVolunteerByUserId(userId: string): Promise<VolunteerRow | null>;
  /** Check-in scoping — open (non-cancelled) FOOD_EVENT tasks only. */
  findActiveEventTask(volunteerId: string, eventId: string): Promise<VolunteerTask | null>;
  /** Walk-in scoping — ANY FOOD_EVENT task for the volunteer on this event. */
  findEventTask(volunteerId: string, eventId: string): Promise<VolunteerTask | null>;

  // ── event registrations ───────────────────────────────────────────────────
  listEventRegistrations(eventId: string, status?: string | null): Promise<EventRegistrationRow[]>;
  countActiveRegistrations(eventId: string, activeStatuses: readonly string[]): Promise<number>;
  /** Delivered-units rollup for event reconciliation (tx-aware). */
  aggregateDeliveredUnits(eventId: string, client: DbClient): Promise<{ _sum: { unitsDelivered: number | null } }>;
  countRegistrations(client: DbClient): Promise<number>;
  /** Code-loop uniqueness probe (tx-aware). */
  findRegistrationCodeOwner(code: string, client: DbClient): Promise<{ code: string } | null>;
  findBeneficiaryById(id: string, client: DbClient): Promise<BeneficiaryRow | null>;
  /** (eventId, beneficiaryId) is unique — constraint failures render as conflicts. */
  createRegistration(data: RegistrationCreateData, client: DbClient): Promise<FoodRegistrationRow>;
  /** Duplicate probe on the (eventId, beneficiaryId) unique pair (tx-aware). */
  findRegistrationForEventBeneficiary(eventId: string, beneficiaryId: string, client: DbClient): Promise<FoodRegistrationRow | null>;
  /** Reinstate a cancelled/rejected row in place (bulk registration flow). */
  reinstateRegistration(id: string, units: number, client: DbClient): Promise<void>;

  // ── walk-in ───────────────────────────────────────────────────────────────
  findRegistrationByBeneficiaryPhone(eventId: string, phoneSuffix: string): Promise<RegistrationWithBeneficiary | null>;

  // ── admin queue (GET/PATCH /registrations) ────────────────────────────────
  listRegistrations(filters: RegistrationQueueFilters): Promise<RegistrationQueueRow[]>;
  findRegistrationWithEventSummary(id: string): Promise<RegistrationWithEventSummary | null>;
  updateRegistration(id: string, data: RegistrationUpdateData): Promise<FoodRegistrationRow>;
  findRegistrationById(id: string, client?: DbClient): Promise<FoodRegistrationRow | null>;
  findRegistrationByIdOrThrow(id: string, client?: DbClient): Promise<FoodRegistrationRow>;

  // ── event volunteer staffing ──────────────────────────────────────────────
  listAssignedVolunteerIds(eventId: string): Promise<Array<{ volunteerId: string }>>;
  listAvailableVolunteers(excludeVolunteerIds: string[]): Promise<Array<{
    id: string; code: string; user: { name: string; phone: string | null };
  }>>;
  listEventVolunteerTasks(eventId: string): Promise<VolunteerTaskWithVolunteer[]>;
  findVolunteerWithUser(id: string): Promise<(Volunteer & { user: { name: string } }) | null>;
  findActiveAssignment(volunteerId: string, eventId: string): Promise<VolunteerTask | null>;
  createVolunteerTask(data: VolunteerTaskCreateData): Promise<VolunteerTaskWithVolunteer>;
  findTaskWithVolunteer(taskId: string): Promise<VolunteerTaskWithVolunteer | null>;
  cancelTask(taskId: string): Promise<void>;
}
