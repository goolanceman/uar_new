/**
 * Medical camp repository contract — persistence operations for camps.
 * The service layer depends on this interface, never on Prisma directly.
 */
import type { Campaign, MedicalCamp, Prisma } from "@prisma/client";

/** Row shape of the camp list (legacy include on GET /). */
export type CampListRow = Prisma.MedicalCampGetPayload<{
  include: {
    campaign: { select: { id: true; title: true; slug: true; accent: true; icon: true } };
    _count: { select: { registrations: true } };
  };
}>;

/** Row shape of the camp detail (legacy include on GET /:id). */
export type CampDetailRow = Prisma.MedicalCampGetPayload<{
  include: {
    campaign: { select: { id: true; title: true; slug: true; accent: true; icon: true } };
    campPartners: {
      include: { org: { select: { id: true; name: true; type: true; city: true; status: true } } };
    };
    campStaff: {
      include: {
        professional: { select: { id: true; name: true; kind: true; speciality: true } };
      };
    };
  };
}>;

/** List filter — the service normalizes status (requestedStatus) and decides
 *  the anonymous clamp; the repository translates this into the exact legacy
 *  where-clause, in the same assignment order. */
export interface CampListFilter {
  status?: string;
  anonymous: boolean;
  city?: string;
  campaignId?: string;
  upcoming: boolean;
  q?: string;
}

/** groupBy aggregate rows for the withCounts projection. */
export interface CampCountAgg {
  campId: string;
  total: number;
}

export interface CampCounts {
  registrations: number;
  checkedIn: number;
  completed: number;
}

export interface CampCreateData {
  code: string;
  title: string;
  description: string | null;
  campaignId: string | null;
  campDate: Date;
  startTime: string | null;
  endTime: string | null;
  venue: string;
  city: string | null;
  capacity: number;
  expectedCount: number | null;
  services: string | null;
  coordinatorName: string | null;
  budget: number | null;
  notes: string | null;
  createdByName: string;
}

/** PATCH patch — `undefined` means "field absent" (not written); `null`
 *  means the legacy handler explicitly cleared the column. */
export interface MedicalCampUpdatePatch {
  status?: string;
  title?: string;
  description?: string | null;
  campDate?: Date;
  startTime?: string | null;
  endTime?: string | null;
  venue?: string;
  city?: string | null;
  capacity?: number;
  expectedCount?: number | null;
  services?: string | null;
  coordinatorName?: string | null;
  budget?: number | null;
  notes?: string | null;
}

export interface MedicalCampRepository {
  listWithCount(
    filter: CampListFilter,
    skip: number,
    take: number,
    upcoming: boolean
  ): Promise<{ rows: CampListRow[]; total: number }>;
  attendanceCounts(ids: string[]): Promise<{ checkedIn: CampCountAgg[]; completed: CampCountAgg[] }>;

  findDetailById(id: string): Promise<CampDetailRow | null>;
  countsForCamp(id: string): Promise<CampCounts>;

  findCampaignById(id: string): Promise<Campaign | null>;
  create(data: CampCreateData): Promise<MedicalCamp>;

  findById(id: string): Promise<MedicalCamp | null>;
  update(id: string, patch: MedicalCampUpdatePatch): Promise<MedicalCamp>;

  findWithRegistrationCount(id: string): Promise<(MedicalCamp & { _count: { registrations: number } }) | null>;
  delete(id: string): Promise<void>;
}
