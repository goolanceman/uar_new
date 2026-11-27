/**
 * Health professional repository contract — persistence operations for the
 * professional directory. The service layer depends on this interface, never
 * on Prisma directly.
 */
import type { Prisma } from "@prisma/client";

/** Row shape of the paged directory list (legacy include on GET /). */
export type HealthProfessionalListRow = Prisma.HealthProfessionalGetPayload<{
  include: {
    org: { select: { id: true; name: true; type: true } };
    user: { select: { id: true; name: true; email: true } };
  };
}>;

/** Row shape of the detail view (legacy include on GET /:id). */
export type HealthProfessionalDetailRow = Prisma.HealthProfessionalGetPayload<{
  include: {
    org: { select: { id: true; name: true; type: true; city: true } };
    user: { select: { id: true; name: true; email: true } };
    _count: { select: { campStaff: true; encounters: true; appointments: true } };
  };
}>;

/** Row shape returned by create/update (legacy include org {id, name}). */
export type HealthProfessionalSavedRow = Prisma.HealthProfessionalGetPayload<{
  include: { org: { select: { id: true; name: true } } };
}>;

/** Fields the PATCH path reads off the pre-update row. */
export interface HealthProfessionalExisting {
  id: string;
  orgId: string | null;
  verificationStatus: string;
}

export interface HealthProfessionalListFilter {
  q?: string;
  kind?: string;
  orgId?: string;
  verificationStatus?: string;
  active?: boolean;
}

export interface HealthProfessionalCreateData {
  name: string;
  kind: string;
  orgId: string | null;
  regNumber: string | null;
  qualification: string | null;
  speciality: string | null;
  experienceYears: number | null;
  phone: string | null;
  email: string | null;
  availability: string | null;
}

export interface HealthProfessionalRepository {
  /** Org id owned by a HOSPITAL portal user (ownerUserId is unique). */
  findOrgIdByOwner(userId: string): Promise<string | null>;
  /** Existence check for an ADMIN-provided orgId. */
  findOrgById(id: string): Promise<{ id: string } | null>;
  /** Paged directory (newest first) with the org/user reference selects. */
  list(
    filter: HealthProfessionalListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: HealthProfessionalListRow[]; total: number }>;
  findDetailById(id: string): Promise<HealthProfessionalDetailRow | null>;
  /** Pre-update lookup (PATCH reads orgId + verificationStatus off it). */
  findById(id: string): Promise<HealthProfessionalExisting | null>;
  create(data: HealthProfessionalCreateData): Promise<HealthProfessionalSavedRow>;
  /** Full Prisma update input: PATCH may connect/disconnect the org. */
  update(id: string, data: Prisma.HealthProfessionalUpdateInput): Promise<HealthProfessionalSavedRow>;
}
