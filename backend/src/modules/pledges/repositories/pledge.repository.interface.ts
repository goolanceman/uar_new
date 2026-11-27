/**
 * Pledge repository contract — persistence for medicine pledges and their
 * linked donation installments. The service layer depends on this interface,
 * never on Prisma directly.
 */
export interface PledgeCauseSummary {
  code: string;
  patientName: string;
  condition: string;
  monthlyCost: number;
}

export interface PledgeRow {
  id: string;
  causeId: string;
  donorId: string | null;
  donorName: string;
  amountPerMonth: number;
  months: number;
  startDate: Date;
  status: string;
  completedAt: Date | null;
  createdAt: Date;
}

export interface PledgeWithCause extends PledgeRow {
  cause: PledgeCauseSummary;
}

export interface DonationRow {
  id: string;
  pledgeId: string | null;
  receiptNumber: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  createdAt: Date;
}

export interface PledgeListFilter {
  status?: string;
  q?: string;
}

export interface PledgeRepository {
  /** Admin list — newest first, cause summary attached, capped at 200. */
  listAll(filter: PledgeListFilter): Promise<PledgeWithCause[]>;
  /** One donor's pledges — newest first, cause summary attached. */
  listByDonor(donorId: string): Promise<PledgeWithCause[]>;
  findById(id: string): Promise<PledgeRow | null>;
  findWithCauseById(id: string): Promise<PledgeWithCause | null>;
  /** Payments made against any of the given pledges. */
  findDonationsForPledges(pledgeIds: string[]): Promise<DonationRow[]>;
  findDonationsForPledge(pledgeId: string): Promise<DonationRow[]>;
  updateStatus(id: string, status: string): Promise<PledgeRow>;
  deletePledge(id: string): Promise<void>;
}
