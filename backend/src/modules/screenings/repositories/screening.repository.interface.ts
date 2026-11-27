/**
 * Screening repository contract — persistence operations for screening
 * observations. The service depends on this interface, never on Prisma
 * directly.
 */
import type { Prisma } from "@prisma/client";

/** Row shape returned to the wire (legacy include on list + create). */
export type ScreeningRecordRow = Prisma.ScreeningRecordGetPayload<{
  include: {
    beneficiary: { select: { id: true; code: true; name: true } };
    camp: { select: { id: true; code: true; title: true } };
  };
}>;

export type ScreeningCreatedRow = Prisma.ScreeningRecordGetPayload<{
  include: { beneficiary: { select: { id: true; code: true; name: true } } };
}>;

export interface ScreeningListFilters {
  beneficiaryId?: string;
  campId?: string;
  encounterId?: string;
  type?: string;
  abnormal?: boolean;
}

export interface ScreeningRepository {
  findBeneficiaryRef(
    id: string
  ): Promise<{ id: string; code: string } | null>;
  findCampRef(id: string): Promise<{ id: string } | null>;
  findEncounterRef(id: string): Promise<{ id: string } | null>;
  create(data: {
    beneficiaryId: string;
    campId: string | null;
    encounterId: string | null;
    type: string;
    result: string;
    abnormal: boolean;
    recordedByName: string;
  }): Promise<ScreeningCreatedRow>;
  list(
    filters: ScreeningListFilters,
    skip: number,
    limit: number
  ): Promise<{ rows: ScreeningRecordRow[]; total: number }>;
}
