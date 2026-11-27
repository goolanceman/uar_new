/**
 * Prisma implementation of the pledge repository — the ONLY place in the
 * pledges module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  DonationRow,
  PledgeListFilter,
  PledgeRepository,
  PledgeRow,
  PledgeWithCause,
} from "./pledge.repository.interface";

const CAUSE_INCLUDE = {
  cause: { select: { code: true, patientName: true, condition: true, monthlyCost: true } },
} as const;

export class PrismaPledgeRepository implements PledgeRepository {
  async listAll(filter: PledgeListFilter): Promise<PledgeWithCause[]> {
    const rows = await db.pledge.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q ? { donorName: { contains: filter.q } } : {}),
      },
      include: CAUSE_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows as PledgeWithCause[];
  }

  async listByDonor(donorId: string): Promise<PledgeWithCause[]> {
    const rows = await db.pledge.findMany({
      where: { donorId },
      orderBy: { createdAt: "desc" },
      include: CAUSE_INCLUDE,
    });
    return rows as PledgeWithCause[];
  }

  async findById(id: string): Promise<PledgeRow | null> {
    return db.pledge.findUnique({ where: { id } });
  }

  async findWithCauseById(id: string): Promise<PledgeWithCause | null> {
    const row = await db.pledge.findUnique({ where: { id }, include: CAUSE_INCLUDE });
    return (row as PledgeWithCause) ?? null;
  }

  async findDonationsForPledges(pledgeIds: string[]): Promise<DonationRow[]> {
    if (!pledgeIds.length) return [];
    return db.donation.findMany({ where: { pledgeId: { in: pledgeIds } } });
  }

  async findDonationsForPledge(pledgeId: string): Promise<DonationRow[]> {
    return db.donation.findMany({ where: { pledgeId } });
  }

  async updateStatus(id: string, status: string): Promise<PledgeRow> {
    return db.pledge.update({ where: { id }, data: { status } });
  }

  /** Donations may reference the pledge — an FK conflict maps to a 409. */
  async deletePledge(id: string): Promise<void> {
    await mapPrismaError(() => db.pledge.delete({ where: { id } }));
  }
}
