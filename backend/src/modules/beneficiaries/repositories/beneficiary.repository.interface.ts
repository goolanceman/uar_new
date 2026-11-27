/**
 * Beneficiary repository contract — case records, case notes and the KYC
 * file-asset lookups. The service layer depends on this interface, never on
 * Prisma directly.
 */
import type { Beneficiary, BeneficiaryNote } from "@prisma/client";

export type BeneficiaryRow = Beneficiary;
export type BeneficiaryNoteRow = BeneficiaryNote;

/** List shape — rows carry the active-recurring-needs count. */
export type BeneficiaryListRow = Beneficiary & {
  _count: { recurringNeeds: number };
};

export interface BeneficiaryListFilters {
  q?: string;
  category?: string;
  active?: string;
  caseStatus?: string;
  verificationStatus?: string;
  hasRecurringNeeds?: string;
}

export interface BeneficiaryCreateData {
  code: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  guardian: string | null;
  age: number | null;
  gender: string | null;
  monthlyNeed: number | null;
  documents: string | null;
  caseStatus: string;
  verificationStatus: string;
  caseWorker: string | null;
  photoConsent: boolean;
  intakeDate: Date | null;
  category: string;
  urgencyLevel: string;
  familyMembers: number;
  monthlyIncome: number | null;
  needs: string | null;
  notes: string | null;
  address: string | null;
  onboardedByName: string;
}

export interface BeneficiaryUpdateData {
  name?: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  category?: string;
  urgencyLevel?: string;
  familyMembers?: number;
  monthlyIncome?: number | null;
  needs?: string | null;
  notes?: string | null;
  isActive?: boolean;
  caseStatus?: string;
  verificationStatus?: string;
  intakeDate?: Date;
  kycStatus?: string;
  kycDocuments?: string;
  kycNotes?: string | null;
  kycReviewedAt?: Date;
  kycReviewedBy?: string;
}

export interface BeneficiaryNoteCreateData {
  beneficiaryId: string;
  authorName: string;
  note: string;
}

/** KYC document check — file assets any mime, judged by admins.
 *  uploadedById is nullable on FileAsset (legacy compared it directly). */
export interface FileAssetSummary {
  id: string;
  uploadedById: string | null;
  mime: string;
}

export interface BeneficiaryRepository {
  /** ?mine=1 — the caller's own case record (userId unique). */
  findBeneficiaryByUserId(userId: string): Promise<BeneficiaryRow | null>;
  findBeneficiaryById(id: string): Promise<BeneficiaryRow | null>;
  /** Unpaginated list — legacy array shape when no ?page/limit. */
  listBeneficiaries(filters: BeneficiaryListFilters): Promise<BeneficiaryListRow[]>;
  /** Paginated list — returns the total for the envelope. */
  listBeneficiariesPaged(
    filters: BeneficiaryListFilters,
    skip: number,
    take: number
  ): Promise<{ rows: BeneficiaryListRow[]; total: number }>;
  /** code is unique — constraint failures render as conflicts. */
  createBeneficiary(data: BeneficiaryCreateData): Promise<BeneficiaryRow>;
  updateBeneficiary(id: string, data: BeneficiaryUpdateData): Promise<BeneficiaryRow>;
  /** Relations cascade (or set-null) on delete — no FK violation risk. */
  deleteBeneficiary(id: string): Promise<void>;

  listNotes(beneficiaryId: string): Promise<BeneficiaryNoteRow[]>;
  /** beneficiaryId is an FK — constraint failures render as conflicts. */
  createNote(data: BeneficiaryNoteCreateData): Promise<BeneficiaryNoteRow>;

  findFileAssetsByIds(ids: string[]): Promise<FileAssetSummary[]>;
}
