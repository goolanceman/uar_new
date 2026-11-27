/**
 * Cause repository contract — persistence for causes and pledges. The
 * service layer depends on this interface, never on Prisma directly.
 */
import type { Cause, Donation, Pledge, Prisma } from "@prisma/client";

/** Public list row — cause with its ACTIVE pledges (oldest first). */
export type CauseWithActivePledges = Prisma.CauseGetPayload<{
  include: {
    pledges: {
      where: { status: "ACTIVE" };
      select: {
        id: true;
        donorName: true;
        amountPerMonth: true;
        months: true;
        status: true;
      };
      orderBy: { createdAt: "asc" };
    };
  };
}>;

/** Detail row — cause with ALL pledges (newest first). */
export type CauseWithPledges = Prisma.CauseGetPayload<{
  include: { pledges: { orderBy: { createdAt: "desc" } } };
}>;

export type PledgeWithCause = Prisma.PledgeGetPayload<{
  include: {
    cause: {
      select: {
        code: true;
        patientName: true;
        condition: true;
        monthlyCost: true;
      };
    };
  };
}>;

export interface CauseListFilter {
  condition?: string;
  status?: string;
  q?: string;
}

export interface PledgeListFilter {
  donorId?: string;
  causeId?: string;
}

export interface CreateCauseData {
  code: string;
  patientName: string;
  age: number;
  city: string;
  condition: string;
  monthlyCost: number;
  durationMonths: number;
  story: string;
}

export interface UpdateCauseData {
  patientName?: string;
  age?: number;
  city?: string;
  condition?: string;
  monthlyCost?: number;
  durationMonths?: number;
  story?: string;
  status?: string;
}

export interface CreatePledgeData {
  causeId: string;
  donorId: string | null;
  donorName: string;
  amountPerMonth: number;
  months: number;
  startDate: Date;
  status: string;
}

export interface CauseRepository {
  /** Public catalog — filtered causes with their ACTIVE pledges. */
  list(filter: CauseListFilter): Promise<CauseWithActivePledges[]>;
  listPledges(filter: PledgeListFilter): Promise<PledgeWithCause[]>;
  /** Installment payments for the pledge schedule projection. */
  listDonationsByPledgeIds(ids: string[]): Promise<Donation[]>;

  /** Cause code sequence — count, then probe candidates until free. */
  count(): Promise<number>;
  findByCode(code: string): Promise<Cause | null>;
  create(data: CreateCauseData): Promise<Cause>;

  findDetailById(id: string): Promise<CauseWithPledges | null>;
  findById(id: string): Promise<Cause | null>;
  update(id: string, data: UpdateCauseData): Promise<Cause>;
  deletePledges(causeId: string): Promise<number>;
  remove(id: string): Promise<void>;

  createPledge(data: CreatePledgeData): Promise<Pledge>;
}
