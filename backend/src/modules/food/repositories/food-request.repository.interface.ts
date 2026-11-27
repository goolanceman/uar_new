/**
 * Food request repository contract — BeneficiaryRequest (assistance
 * applications), the Beneficiary identity aggregate and the admin worklist
 * Notification writes. The service layer depends on this interface, never on
 * Prisma directly. Transactional methods accept the caller's `client`
 * (withTransaction boundary) — repositories never obtain clients themselves.
 */
import type { Beneficiary, BeneficiaryRequest } from "@prisma/client";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";

export type BeneficiaryRow = Beneficiary;
export type BeneficiaryRequestRow = BeneficiaryRequest;

/** GET /applications — review-queue include (beneficiary summary). */
export type ApplicationRow = BeneficiaryRequest & {
  beneficiary: { id: string; code: string; name: string } | null;
};

/** Status-check select shape (minimum disclosure for applicants). */
export type ApplicationStatusRow = Pick<
  BeneficiaryRequest,
  "phone" | "status" | "reviewNote" | "createdAt" | "updatedAt" | "name"
>;

/** Duplicate-check select shape. */
export type ApplicationDuplicateRow = Pick<BeneficiaryRequest, "refCode" | "createdAt">;

export interface ApplicationCreateData {
  refCode: string;
  beneficiaryId: string | null;
  userId: string | null;
  name: string;
  phone: string;
  category: string;
  urgency: string;
  details: string;
  address: string | null;
  city: string | null;
  pincode: string | null;
  familyMembers: number | null;
  childrenCount: number | null;
  seniorCount: number | null;
  dietary: string | null;
  preferredContact: string;
  consent: boolean;
  source: string;
}

export interface ApplicationUpdateData {
  status: string;
  reviewNote: string | null;
  reviewedBy: string;
  reviewedAt: Date;
  beneficiaryId?: string;
}

export interface BeneficiaryCreateData {
  code: string;
  name: string;
  phone: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  category: string;
  urgencyLevel: string;
  familyMembers: number;
  needs: string;
  caseStatus: string;
  onboardedByName: string;
  intakeDate: Date;
}

export interface NotificationCreateData {
  title: string;
  message: string;
  type: string;
  actionUrl: string;
}

export interface FoodRequestRepository {
  listApplications(status?: string | null): Promise<ApplicationRow[]>;

  findRequestByRefCode(refCode: string): Promise<ApplicationStatusRow | null>;
  findRequestById(id: string): Promise<BeneficiaryRequestRow | null>;
  /** Open (PENDING/IN_REVIEW) request from the same phone — duplicate gate. */
  findOpenRequestByPhone(phone: string): Promise<ApplicationDuplicateRow | null>;
  /** refCode is unique — constraint failures render as conflicts. */
  createRequest(data: ApplicationCreateData): Promise<BeneficiaryRequestRow>;
  /** Joins the caller's withTransaction boundary when provided. */
  updateRequest(id: string, data: ApplicationUpdateData): Promise<ApplicationRow>;

  // ── beneficiary identity (shared by review approval + walk-ins) ──────────
  findBeneficiaryByUserId(userId: string): Promise<BeneficiaryRow | null>;
  findBeneficiaryById(id: string): Promise<BeneficiaryRow | null>;
  /** code is unique — constraint failures render as conflicts. */
  createBeneficiary(data: BeneficiaryCreateData, client?: DbClient): Promise<BeneficiaryRow>;
  countBeneficiaries(client: DbClient): Promise<number>;
  /** Code-loop uniqueness probe (tx-aware). */
  findBeneficiaryCodeOwner(code: string, client: DbClient): Promise<{ code: string } | null>;
  /** Earliest beneficiary whose phone contains the given digits (walk-in reuse). */
  findBeneficiaryByPhoneContains(phone: string): Promise<BeneficiaryRow | null>;
  updateBeneficiaryName(id: string, name: string, client: DbClient): Promise<void>;

  // ── admin worklist notifications (no PII beyond first name) ──────────────
  createNotification(data: NotificationCreateData): Promise<void>;
}
