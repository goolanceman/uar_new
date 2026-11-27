/**
 * Medical document repository contract — persistence operations for patient
 * medical documents. The service layer depends on this interface, never on
 * Prisma directly.
 */
import type { Prisma } from "@prisma/client";

/** Row shape returned to the wire (legacy include on list/get/create). */
export type MedicalDocumentRow = Prisma.MedicalDocumentGetPayload<{
  include: {
    beneficiary: { select: { id: true; code: true; name: true } };
    camp: { select: { id: true; code: true; title: true } };
  };
}>;

/** Row shape the delete path needs (legacy include on pre-delete lookup). */
export type MedicalDocumentDeleteRow = Prisma.MedicalDocumentGetPayload<{
  include: { beneficiary: { select: { code: true } } };
}>;

export interface MedicalDocumentListWhere {
  beneficiaryId?: string;
}

export interface MedicalDocumentCreateData {
  beneficiaryId: string;
  campId: string | null;
  name: string;
  kind: string;
  url: string;
  uploadedByName: string | null;
}

export interface MedicalDocumentRepository {
  /** Patient record id linked to a user account (null when unlinked). */
  findBeneficiaryIdByUserId(userId: string): Promise<string | null>;
  findBeneficiaryRef(id: string): Promise<{ id: string; code: string } | null>;
  findCampRef(id: string): Promise<{ id: string } | null>;

  countDocuments(where: MedicalDocumentListWhere): Promise<number>;
  listDocuments(
    where: MedicalDocumentListWhere,
    skip: number,
    take: number
  ): Promise<MedicalDocumentRow[]>;

  findDocumentById(id: string): Promise<MedicalDocumentRow | null>;
  findDocumentForDelete(id: string): Promise<MedicalDocumentDeleteRow | null>;
  createDocument(data: MedicalDocumentCreateData): Promise<MedicalDocumentRow>;
  deleteDocument(id: string): Promise<void>;
}
