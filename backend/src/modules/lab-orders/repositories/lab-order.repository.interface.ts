/**
 * Lab order repository contract — persistence operations for diagnostic
 * orders. The service layer depends on this interface, never on Prisma
 * directly.
 */
import type { Prisma } from "@prisma/client";

/** Row shape with the legacy ORDER_INCLUDE reference selects. */
export type LabOrderRow = Prisma.DiagnosticOrderGetPayload<{
  include: {
    beneficiary: { select: { id: true; code: true; name: true; age: true; gender: true } };
    camp: { select: { id: true; code: true; title: true } };
    encounter: { select: { id: true; status: true; diagnosis: true } };
  };
}>;

/** Fields the PATCH path reads off the pre-update row. */
export interface LabOrderExisting {
  id: string;
  code: string;
  testName: string;
  status: string;
  resultText: string | null;
  resultFileUrl: string | null;
}

export interface LabOrderListFilter {
  beneficiaryId?: string;
  campId?: string;
  status?: string;
  q?: string;
}

export interface LabOrderCreateData {
  code: string;
  beneficiaryId: string;
  campId: string | null;
  encounterId: string | null;
  testName: string;
  orderedByName: string;
}

export interface LabOrderRepository {
  /** BENEFICIARY list scoping (findUnique over userId). */
  findBeneficiaryIdByUserId(userId: string): Promise<{ id: string } | null>;
  /** Beneficiary existence + code (logActivity detail). */
  findBeneficiaryRef(id: string): Promise<{ id: string; code: string } | null>;
  findCampRef(id: string): Promise<{ id: string } | null>;
  findEncounterRef(id: string): Promise<{ id: string } | null>;
  createOrder(data: LabOrderCreateData): Promise<LabOrderRow>;
  /** Paged list (newest first) with the ORDER_INCLUDE reference selects. */
  list(filter: LabOrderListFilter, skip: number, take: number): Promise<{ rows: LabOrderRow[]; total: number }>;
  findById(id: string): Promise<LabOrderExisting | null>;
  findByIdWithInclude(id: string): Promise<LabOrderRow | null>;
  /** PATCH data is a plain key/value map built field-by-field (legacy shape). */
  updateOrder(id: string, data: Record<string, unknown>): Promise<LabOrderRow>;
}
