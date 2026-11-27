/**
 * Health org repository contract — persistence operations for healthcare
 * organisations. The service layer depends on this interface, never on
 * Prisma directly.
 */
import type { HealthcareOrg, Prisma } from "@prisma/client";

/** Row shape of the ADMIN/HOSPITAL paged list (legacy include on GET /). */
export type HealthOrgListRow = Prisma.HealthcareOrgGetPayload<{
  include: {
    owner: { select: { id: true; name: true; email: true } };
    _count: { select: { staff: true; campPartners: true } };
  };
}>;

/** Row shape of the DOCTOR directory list (legacy select on GET /). */
export interface HealthOrgDirectoryRow {
  id: string;
  name: string;
  type: string;
  city: string | null;
  status: string;
}

/** Row shape of the detail view (legacy include on GET /:id). */
export type HealthOrgDetailRow = Prisma.HealthcareOrgGetPayload<{
  include: {
    owner: { select: { id: true; name: true, email: true } };
    staff: true;
    _count: { select: { campPartners: true; referrals: true } };
  };
}>;

/** Fields the PATCH path reads off the pre-update row. */
export interface HealthOrgExisting {
  id: string;
  ownerUserId: string | null;
  status: string;
}

/** Fields the DELETE path reads off the pre-delete row. */
export interface HealthOrgWithPartnerCount {
  id: string;
  name: string;
  status: string;
  _count: { campPartners: number };
}

export interface HealthOrgAdminListFilter {
  q?: string;
  status?: string;
  type?: string;
  /** HOSPITAL role — pin the list to the org the session owns. */
  ownerUserId?: string;
}

export interface HealthOrgCreateData {
  name: string;
  type: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  regNumber: string | null;
  licences: string | null;
  services: string | null;
  facilities: string | null;
  operatingHours: string | null;
  notes: string | null;
}

export interface HealthOrgRepository {
  /** ADMIN/HOSPITAL paged list (newest first) with owner + counts. */
  listAdmin(
    filter: HealthOrgAdminListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: HealthOrgListRow[]; total: number }>;
  /** DOCTOR referral directory: VERIFIED orgs only, name asc, directory fields.
   *  Legacy kept the query's type filter (only status was overwritten to VERIFIED). */
  listDoctorDirectory(
    q: string | undefined,
    type: string | undefined,
    skip: number,
    take: number
  ): Promise<{ rows: HealthOrgDirectoryRow[]; total: number }>;
  createOrg(data: HealthOrgCreateData): Promise<HealthcareOrg>;
  findDetailById(id: string): Promise<HealthOrgDetailRow | null>;
  /** Pre-update lookup (PATCH reads ownerUserId + status off it). */
  findById(id: string): Promise<HealthOrgExisting | null>;
  /** Pre-delete lookup (DELETE reads name/status/partner count off it). */
  findWithPartnerCount(id: string): Promise<HealthOrgWithPartnerCount | null>;
  updateOrg(id: string, data: Prisma.HealthcareOrgUpdateInput): Promise<HealthcareOrg>;
  /** Release optional professional references so SQLite FKs stay satisfied. */
  detachProfessionals(id: string): Promise<void>;
  /** Release optional referral references so SQLite FKs stay satisfied. */
  detachReferrals(id: string): Promise<void>;
  deleteOrg(id: string): Promise<void>;
}
