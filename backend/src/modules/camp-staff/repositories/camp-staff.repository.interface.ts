/**
 * Camp staff repository contract — persistence operations for camp staff
 * assignments. The service layer depends on this interface, never on Prisma
 * directly.
 */
import type { Prisma } from "@prisma/client";

/** Row shape of the paged roster (legacy include on GET /). */
export type CampStaffListRow = Prisma.CampStaffGetPayload<{
  include: {
    professional: { select: { id: true; name: true; kind: true; speciality: true; verificationStatus: true } };
    camp: { select: { id: true; code: true; title: true; status: true } };
  };
}>;

/** Row shape returned by create (legacy include professional select). */
export type CampStaffCreatedRow = Prisma.CampStaffGetPayload<{
  include: {
    professional: { select: { id: true; name: true; kind: true; speciality: true; verificationStatus: true } };
  };
}>;

/** Row shape returned after a status change (legacy findUniqueOrThrow include). */
export type CampStaffUpdatedRow = Prisma.CampStaffGetPayload<{
  include: {
    professional: { select: { id: true; name: true, kind: true, speciality: true } };
  };
}>;

/** Fields the DELETE path reads off the pre-delete row. */
export interface CampStaffWithProfessionalName {
  id: string;
  campId: string;
  role: string;
  professional: { name: string } | null;
}

/** Fields the PATCH path reads off the pre-update row. */
export interface CampStaffWithRefs {
  id: string;
  status: string;
  professional: { name: string } | null;
  camp: { title: string };
}

export interface CampStaffListFilter {
  campId?: string;
  status?: string;
}

export interface CampStaffCreateData {
  campId: string;
  professionalId: string | null;
  volunteerId: string | null;
  role: string;
  notes: string | null;
}

export interface CampStaffRepository {
  findCampById(id: string): Promise<{ id: string; title: string } | null>;
  /** Org id owned by a HOSPITAL portal user (ownerUserId is unique). */
  findOrgIdByOwner(userId: string): Promise<string | null>;
  findAcceptedPartner(campId: string, orgId: string): Promise<{ id: string } | null>;
  /** Own-staff check for HOSPITAL partners (scoped to their org). */
  findProfessionalInOrg(professionalId: string, orgId: string): Promise<{ id: string } | null>;
  /** Full professional row (PATCH reads kind + verificationStatus off it). */
  findProfessionalById(id: string): Promise<{ id: string; kind: string; verificationStatus: string } | null>;
  findVolunteerById(id: string): Promise<{ id: string } | null>;
  createStaff(data: CampStaffCreateData): Promise<CampStaffCreatedRow>;
  list(filter: CampStaffListFilter, skip: number, take: number): Promise<{ rows: CampStaffListRow[]; total: number }>;
  /** Pre-delete lookup (DELETE reads campId/role/professional name off it). */
  findStaffWithProfessional(id: string): Promise<CampStaffWithProfessionalName | null>;
  deleteStaff(id: string): Promise<void>;
  /** Pre-update lookup (PATCH reads status/professional name/camp title off it). */
  findStaffWithRefs(id: string): Promise<CampStaffWithRefs | null>;
  /** Optimistic-concurrency status change — returns the matched count. */
  updateStatusGuarded(id: string, expectedStatus: string, status: string): Promise<number>;
  /** Post-update reload (legacy findUniqueOrThrow include). */
  findStaffWithProfessionalInclude(id: string): Promise<CampStaffUpdatedRow>;
}
