/**
 * Encounter repository contract — persistence operations for clinical
 * encounters. The service layer depends on this interface, never on Prisma
 * directly.
 */
import type { Prisma } from "@prisma/client";

/** List include (legacy ENCOUNTER_INCLUDE). */
export const ENCOUNTER_LIST_INCLUDE = {
  beneficiary: {
    select: { id: true, code: true, name: true, age: true, gender: true, phone: true },
  },
  doctor: {
    select: { id: true, name: true, regNumber: true, speciality: true, kind: true },
  },
  camp: { select: { id: true, code: true, title: true, venue: true, city: true, campDate: true } },
} as const;

/** Detail include used by GET/PATCH /:id — adds bloodGroup + allergies to the
 *  beneficiary projection (as in the original [id] route handler). */
export const ENCOUNTER_DETAIL_INCLUDE = {
  beneficiary: {
    select: {
      id: true, code: true, name: true, age: true, gender: true, phone: true,
      bloodGroup: true, allergies: true,
    },
  },
  doctor: {
    select: { id: true, name: true, regNumber: true, speciality: true, kind: true },
  },
  camp: { select: { id: true, code: true, title: true, venue: true, city: true, campDate: true } },
} as const;

/** Detail + related-lists include used by GET /:id (vitals, screenings,
 *  prescriptions, labOrders, referrals). */
export const ENCOUNTER_FULL_DETAIL_INCLUDE = {
  ...ENCOUNTER_DETAIL_INCLUDE,
  vitals: { orderBy: { recordedAt: "desc" } },
  screenings: { orderBy: { recordedAt: "desc" } },
  prescriptions: {
    select: { id: true, code: true, status: true, createdAt: true, diagnosis: true },
  },
  labOrders: {
    select: { id: true, code: true, testName: true, status: true, critical: true, createdAt: true },
  },
  referrals: {
    select: { id: true, code: true, status: true, priority: true, reason: true, createdAt: true },
  },
} as const;

/** Sign include used by POST /:id/sign. */
export const ENCOUNTER_SIGN_INCLUDE = {
  beneficiary: {
    select: { id: true, code: true, name: true, age: true, gender: true },
  },
  doctor: {
    select: { id: true, name: true, regNumber: true, speciality: true, kind: true },
  },
  camp: { select: { id: true, code: true, title: true, venue: true, city: true, campDate: true } },
} as const;

export type EncounterListRow = Prisma.EncounterGetPayload<{ include: typeof ENCOUNTER_LIST_INCLUDE }>;

export type EncounterDetailRow = Prisma.EncounterGetPayload<{ include: typeof ENCOUNTER_DETAIL_INCLUDE }>;

/** GET /:id row — detail include + vitals/screenings/prescriptions/labOrders/referrals. */
export type EncounterFullDetailRow = Prisma.EncounterGetPayload<{
  include: typeof ENCOUNTER_FULL_DETAIL_INCLUDE;
}>;

export type EncounterSignRow = Prisma.EncounterGetPayload<{ include: typeof ENCOUNTER_SIGN_INCLUDE }>;

/** Pre-update row — full encounter + owning doctor identity. */
export type EncounterWithDoctor = Prisma.EncounterGetPayload<{
  include: { doctor: { select: { id: true; userId: true; name: true } } };
}>;

/** Pre-sign row — full encounter + owning doctor identity. */
export type EncounterWithDoctorLite = Prisma.EncounterGetPayload<{
  include: { doctor: { select: { userId: true; name: true } } };
}>;

/** List filter — the service validates status/from-to first, so these arrive
 *  pre-verified. */
export interface EncounterListFilter {
  beneficiaryId?: string;
  campId?: string;
  doctorId?: string;
  status?: string;
  createdAt?: { gte?: Date; lte?: Date };
}

export interface EncounterCreateData {
  campId: string | null;
  registrationId: string | null;
  beneficiaryId: string;
  doctorId: string;
  chiefComplaint: string | null;
  observations: string | null;
  diagnosis: string | null;
  advice: string | null;
  followUpDate: Date | null;
}

/** PATCH patch — `undefined` means "field absent" (not written); `null`
 *  means the legacy handler explicitly cleared the column. */
export interface EncounterUpdateData {
  chiefComplaint?: string | null;
  observations?: string | null;
  diagnosis?: string | null;
  advice?: string | null;
  followUpDate?: Date | null;
  amendments?: string;
}

export interface EncounterRepository {
  list(filter: EncounterListFilter, skip: number, take: number): Promise<{ items: EncounterListRow[]; total: number }>;

  findBeneficiaryLite(id: string): Promise<{ id: string; code: string; name: string } | null>;
  findCampLite(id: string): Promise<{ id: string } | null>;
  findProfessionalByUserId(userId: string): Promise<{ id: string; name: string; kind: string } | null>;
  create(data: EncounterCreateData): Promise<EncounterListRow>;

  findDetailById(id: string): Promise<EncounterFullDetailRow | null>;
  findBeneficiaryIdByUserId(userId: string): Promise<{ id: string } | null>;

  findWithDoctor(id: string): Promise<EncounterWithDoctor | null>;
  updateWithDetail(id: string, data: EncounterUpdateData): Promise<EncounterDetailRow>;

  findWithDoctorForSign(id: string): Promise<EncounterWithDoctorLite | null>;
  sign(id: string, data: { status: string; signedAt: Date; signedByName: string }): Promise<EncounterSignRow>;
}
