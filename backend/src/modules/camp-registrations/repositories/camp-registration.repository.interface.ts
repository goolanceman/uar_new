/**
 * Camp registration repository contract — persistence operations for camp
 * registrations. The service layer depends on this interface, never on
 * Prisma directly.
 */
import type { Prisma } from "@prisma/client";

/** Legacy beneficiary select used on list/create/update includes. */
export const BENEFICIARY_SELECT = {
  id: true,
  code: true,
  name: true,
  phone: true,
  age: true,
  gender: true,
} as const;

/** Row shape of the paged list (legacy include on GET /). */
export type CampRegistrationListRow = Prisma.CampRegistrationGetPayload<{
  include: { beneficiary: { select: typeof BENEFICIARY_SELECT } };
}>;

/** Row shape of the detail view (legacy include on GET /:id). */
export type CampRegistrationDetailRow = Prisma.CampRegistrationGetPayload<{
  include: {
    beneficiary: { select: typeof BENEFICIARY_SELECT };
    camp: { select: { id: true; code: true; title: true; status: true; venue: true; city: true } };
    attendance: true;
  };
}>;

/** Row shape returned by create/update (legacy include beneficiary select). */
export type CampRegistrationSavedRow = Prisma.CampRegistrationGetPayload<{
  include: { beneficiary: { select: typeof BENEFICIARY_SELECT } };
}>;

/** Fields the PATCH path reads off the pre-update row. */
export interface CampRegistrationExisting {
  id: string;
  status: string;
  camp: { code: string; title: string };
}

export interface CampRegistrationListFilter {
  q?: string;
  campId?: string;
  status?: string;
}

/** Role scopes layered on top of the query filters. */
export interface CampRegistrationListScope {
  /** HOSPITAL role — only camps the org partners. */
  partnerOrgId?: string;
  /** BENEFICIARY role — only own registrations. */
  beneficiaryId?: string;
}

export interface CampRegistrationCreateData {
  campId: string;
  beneficiaryId: string;
  code: string;
  registeredVia: string;
  scheduledSlot: Date | null;
  notes: string | null;
  registeredByName: string;
}

export interface CampRegistrationUpdateData {
  status?: string;
  scheduledSlot?: Date | null;
  notes?: string | null;
}

export interface CampRegistrationRepository {
  /** Org id owned by a HOSPITAL portal user (ownerUserId is unique). */
  findOrgIdByOwner(userId: string): Promise<string | null>;
  /** Paged list (newest first) with the beneficiary reference select. */
  list(
    filter: CampRegistrationListFilter,
    scope: CampRegistrationListScope,
    skip: number,
    take: number
  ): Promise<{ rows: CampRegistrationListRow[]; total: number }>;
  /** Camp existence + status/capacity/title gates. */
  findCampById(id: string): Promise<{ id: string; title: string; status: string; capacity: number } | null>;
  /** Beneficiary existence + name (logActivity detail). */
  findBeneficiaryById(id: string): Promise<{ id: string; name: string } | null>;
  findRegistrationByCampAndBeneficiary(campId: string, beneficiaryId: string): Promise<{ id: string } | null>;
  /** Active (non-cancelled/rejected) registration count against capacity. */
  countActiveByCamp(campId: string): Promise<number>;
  /** Self-service profile lookup (POST uses findFirst over userId). */
  findOwnBeneficiaryByUserId(userId: string): Promise<{ id: string } | null>;
  /** List scoping lookup (GET uses findUnique over userId). */
  findBeneficiaryIdByUserId(userId: string): Promise<{ id: string } | null>;
  createRegistration(data: CampRegistrationCreateData): Promise<CampRegistrationSavedRow>;
  findDetailById(id: string): Promise<CampRegistrationDetailRow | null>;
  /** Pre-update lookup (PATCH reads status + camp title/code off it). */
  findExistingWithCamp(id: string): Promise<CampRegistrationExisting | null>;
  updateRegistration(id: string, data: CampRegistrationUpdateData): Promise<CampRegistrationSavedRow>;
}
