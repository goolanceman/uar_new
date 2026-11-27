/**
 * Sponsorship repository contract — persistence operations for beneficiary
 * sponsorships and the donor↔beneficiary matcher. The service layer depends
 * on this interface, never on Prisma directly.
 */
import type { Prisma } from "@prisma/client";
import type { Beneficiary, BeneficiarySponsorship, Donor, RecurringNeed } from "@prisma/client";

/** Include shape used by the list + create queries (legacy INCLUDE const). */
export const SPONSORSHIP_INCLUDE = {
  beneficiary: { select: { id: true, name: true, city: true, category: true, urgencyLevel: true, caseStatus: true } },
  donor: { select: { id: true, name: true, email: true, phone: true, category: true } },
  recurringNeed: { include: { item: { select: { id: true, name: true, unit: true } } } },
} as const;

/** Include shape used by the PATCH update query (legacy inline include). */
export const SPONSORSHIP_UPDATE_INCLUDE = {
  beneficiary: { select: { id: true, name: true } },
  donor: { select: { id: true, name: true } },
  recurringNeed: { include: { item: { select: { id: true, name: true, unit: true } } } },
} as const;

export type SponsorshipRow = Prisma.BeneficiarySponsorshipGetPayload<{
  include: typeof SPONSORSHIP_INCLUDE;
}>;

export type SponsorshipUpdatedRow = Prisma.BeneficiarySponsorshipGetPayload<{
  include: typeof SPONSORSHIP_UPDATE_INCLUDE;
}>;

/** Filter the staff list applies (service resolves the donor self-scope). */
export interface SponsorshipListFilter {
  donorId?: string;
  beneficiaryId?: string;
  status?: string;
}

/** Active recurring need with its beneficiary + item (matcher input). */
export type MatchNeed = Prisma.RecurringNeedGetPayload<{
  include: {
    beneficiary: { select: { id: true; name: true; city: true; urgencyLevel: true } };
    item: { select: { id: true; name: true; unit: true; pricePerUnit: true } };
  };
}>;

/** Candidate donor with its current active-sponsorship load. */
export interface MatchDonor {
  id: string;
  name: string;
  email: string | null;
  category: string | null;
  _count: { sponsorships: number };
}

export interface SponsorshipCreateData {
  beneficiaryId: string;
  donorId: string | null;
  donorName: string;
  recurringNeedId: string | null;
  amountPerMonth: number;
  months: number;
  notes: string | null;
  source: string;
  assignedByName: string;
}

export interface SponsorshipUpdateData {
  status?: string;
  amountPerMonth?: number;
  months?: number;
  notes?: string | null;
}

export interface SponsorshipRepository {
  findDonorIdByUserId(userId: string): Promise<string | null>;
  list(filter: SponsorshipListFilter): Promise<SponsorshipRow[]>;

  findMatchingSettings(): Promise<Array<{ key: string; value: string }>>;
  listMatchableNeeds(): Promise<MatchNeed[]>;
  listDonorsWithLoad(category: string): Promise<MatchDonor[]>;

  findBeneficiaryById(id: string): Promise<Beneficiary | null>;
  findDonorById(id: string): Promise<Donor | null>;
  findRecurringNeedById(id: string): Promise<RecurringNeed | null>;

  create(data: SponsorshipCreateData): Promise<SponsorshipRow>;
  findById(id: string): Promise<BeneficiarySponsorship | null>;
  update(id: string, data: SponsorshipUpdateData): Promise<SponsorshipUpdatedRow>;
  delete(id: string): Promise<void>;
}
