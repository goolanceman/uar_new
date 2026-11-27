/**
 * Vitals repository contract — persistence operations for vital observations.
 * The service depends on this interface, never on Prisma directly.
 */
import type { Prisma } from "@prisma/client";

/** Row shape returned to the wire (legacy include on list + create). */
export type VitalObservationRow = Prisma.VitalObservationGetPayload<{
  include: { beneficiary: { select: { id: true; code: true; name: true } } };
}>;

export interface VitalsListFilters {
  beneficiaryId?: string;
  campId?: string;
  encounterId?: string;
}

export interface VitalsMeasuredValues {
  bpSystolic?: number;
  bpDiastolic?: number;
  pulse?: number;
  tempC?: number;
  respRate?: number;
  spo2?: number;
  heightCm?: number;
  weightKg?: number;
  glucose?: number;
}

export type VitalObservationCreateData = {
  beneficiaryId: string;
  campId: string | null;
  encounterId: string | null;
  recordedByName: string;
  bmi?: number;
} & VitalsMeasuredValues;

export interface VitalObservationRepository {
  findBeneficiaryRef(id: string): Promise<{ id: string; code: string } | null>;
  findCampRef(id: string): Promise<{ id: string } | null>;
  findEncounterRef(id: string): Promise<{ id: string } | null>;
  create(data: VitalObservationCreateData): Promise<VitalObservationRow>;
  list(
    filters: VitalsListFilters,
    skip: number,
    limit: number
  ): Promise<{ rows: VitalObservationRow[]; total: number }>;
}
