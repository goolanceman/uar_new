/**
 * Follow-up repository contract — persistence operations for patient
 * follow-ups. The service layer depends on this interface, never on Prisma
 * directly.
 */
import type { Prisma } from "@prisma/client";

/** Row shape returned to the wire (legacy include on list/get/create). */
export type FollowUpRow = Prisma.FollowUpGetPayload<{
  include: {
    beneficiary: { select: { id: true; code: true; name: true; age: true; gender: true } };
    camp: { select: { id: true; code: true; title: true } };
    referral: { select: { id: true; code: true; status: true; priority: true } };
  };
}>;

/** Row shape returned by the update path (legacy PATCH include, no priority). */
export type FollowUpUpdateRow = Prisma.FollowUpGetPayload<{
  include: {
    beneficiary: { select: { id: true; code: true; name: true } };
    camp: { select: { id: true; code: true; title: true } };
    referral: { select: { id: true; code: true; status: true } };
  };
}>;

export interface FollowUpListWhere {
  beneficiaryId?: string;
  status?: string;
  /** overdue=1: dueDate strictly before this instant (legacy `lt: new Date()`). */
  dueBefore?: Date;
}

export interface FollowUpCreateData {
  beneficiaryId: string;
  campId: string | null;
  referralId: string | null;
  dueDate: Date;
  instructions: string | null;
  ownerName: string | null;
  status: string;
}

/** Field patch — only present keys are written (legacy assembly order kept). */
export interface FollowUpUpdateData {
  status?: string;
  doneAt?: Date | null;
  outcome?: string | null;
}

export interface FollowUpRepository {
  findBeneficiaryIdByUserId(userId: string): Promise<string | null>;
  findBeneficiaryRef(id: string): Promise<{ id: string; code: string } | null>;
  findCampRef(id: string): Promise<{ id: string } | null>;
  findReferralRef(id: string): Promise<{ id: string } | null>;

  listFollowUps(
    where: FollowUpListWhere,
    skip: number,
    take: number,
    overdueOnly: boolean
  ): Promise<{ rows: FollowUpRow[]; total: number }>;

  findFollowUpById(id: string): Promise<FollowUpRow | null>;
  /** Plain row without includes — the PATCH flow only reads status. */
  findFollowUpPlain(id: string): Promise<{ id: string; status: string } | null>;

  createFollowUp(data: FollowUpCreateData): Promise<FollowUpRow>;
  updateFollowUp(id: string, data: FollowUpUpdateData): Promise<FollowUpUpdateRow>;
}
