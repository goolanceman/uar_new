/**
 * Beneficiary-request repository contract — persistence operations for
 * beneficiary help requests. The service layer depends on this interface,
 * never on Prisma directly.
 */

/** Full BeneficiaryRequest scalar shape (the legacy findMany/update/create
 *  responses returned whole rows). */
export interface BeneficiaryRequestRow {
  id: string;
  beneficiaryId: string | null;
  userId: string | null;
  name: string;
  phone: string | null;
  category: string;
  urgency: string;
  details: string;
  status: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  refCode: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  familyMembers: number | null;
  childrenCount: number | null;
  seniorCount: number | null;
  dietary: string | null;
  preferredContact: string | null;
  consent: boolean;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Admin-queue row: includes the linked beneficiary header. */
export interface BeneficiaryRequestWithBeneficiary extends BeneficiaryRequestRow {
  beneficiary: { id: string; name: string; city: string | null } | null;
}

export interface BeneficiaryRequestCreateData {
  beneficiaryId: string | null;
  userId: string | null;
  name: string;
  phone: string | null;
  category: string;
  urgency: string;
  details: string;
}

export interface BeneficiaryRequestUpdateData {
  status?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string | null;
  urgency?: string;
}

export interface BeneficiaryRequestRepository {
  findMine(userId: string): Promise<BeneficiaryRequestRow[]>;
  listAll(status?: string): Promise<BeneficiaryRequestWithBeneficiary[]>;
  findById(id: string): Promise<BeneficiaryRequestRow | null>;
  findBeneficiaryByUserId(userId: string): Promise<{ id: string } | null>;
  create(data: BeneficiaryRequestCreateData): Promise<BeneficiaryRequestRow>;
  update(id: string, data: BeneficiaryRequestUpdateData): Promise<BeneficiaryRequestRow>;
  delete(id: string): Promise<void>;
}
