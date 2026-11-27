/**
 * Prisma implementation of the donor repository — the ONLY place in the
 * donors module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CreateDonorData,
  DonorAggregateRow,
  DonorAnimalPledgeRow,
  DonorDonationRow,
  DonorListFilter,
  DonorPledgeRow,
  DonorRepository,
  DonorWithUser,
  DonorWithUserCity,
  UpdateDonorData,
} from "./donor.repository.interface";

export class PrismaDonorRepository implements DonorRepository {
  private whereFor(filter: DonorListFilter): { type?: string; category?: string; OR?: Array<Record<string, { contains: string }>> } {
    const where: { type?: string; category?: string; OR?: Array<Record<string, { contains: string }>> } = {};
    if (filter.type) where.type = filter.type;
    if (filter.category) where.category = filter.category;
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q } },
        { email: { contains: filter.q } },
        { phone: { contains: filter.q } },
        { organizationName: { contains: filter.q } },
        { code: { contains: filter.q } },
      ];
    }
    return where;
  }

  async list(filter: DonorListFilter, skip: number, take: number): Promise<{ rows: DonorWithUser[]; total: number }> {
    const where = this.whereFor(filter);
    const [donors, total] = await Promise.all([
      db.donor.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take,
        include: { user: { select: { id: true, role: true, status: true } } },
      }),
      db.donor.count({ where }),
    ]);
    return { rows: donors, total };
  }

  async aggregateByEmails(emails: string[]): Promise<DonorAggregateRow[]> {
    const agg = await db.donation.groupBy({
      by: ["donorEmail"],
      where: { donorEmail: { in: emails }, paymentStatus: "COMPLETED" },
      _sum: { amount: true },
      _count: { id: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
    });
    return agg as DonorAggregateRow[];
  }

  async findByEmail(email: string) {
    return db.donor.findUnique({ where: { email } });
  }

  async findUserIdByEmail(email: string): Promise<{ id: string } | null> {
    const user = await db.user.findUnique({ where: { email } });
    return user ? { id: user.id } : null;
  }

  async create(data: CreateDonorData) {
    return mapPrismaError(() => db.donor.create({ data }));
  }

  async findById(id: string): Promise<DonorWithUserCity | null> {
    return db.donor.findUnique({
      where: { id },
      include: { user: { select: { id: true, role: true, status: true, city: true } } },
    });
  }

  async findSimpleById(id: string) {
    return db.donor.findUnique({ where: { id } });
  }

  async update(id: string, data: UpdateDonorData) {
    return db.donor.update({ where: { id }, data });
  }

  async clearDonationLinks(donorRefId: string): Promise<number> {
    const result = await db.donation.updateMany({
      where: { donorRefId },
      data: { donorRefId: null },
    });
    return result.count;
  }

  async remove(id: string): Promise<void> {
    await mapPrismaError(() => db.donor.delete({ where: { id } }));
  }

  async listDonationsByEmail(email: string): Promise<DonorDonationRow[]> {
    return db.donation.findMany({
      where: { donorEmail: email },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { campaign: { select: { title: true, accent: true } } },
    });
  }

  async listPledgesByUserId(userId: string | undefined): Promise<DonorPledgeRow[]> {
    // Legacy `where: { donorId: donor.userId ?? undefined }` — undefined removes
    // the filter entirely (returns ALL pledges), matching the original route.
    return db.pledge.findMany({
      where: { donorId: userId },
      orderBy: { createdAt: "desc" },
      include: { cause: { select: { code: true, patientName: true } } },
    });
  }

  async listAnimalPledgesByUserId(userId: string | undefined): Promise<DonorAnimalPledgeRow[]> {
    return db.animalPledge.findMany({
      where: { donorId: userId },
      orderBy: { createdAt: "desc" },
      include: { animal: { select: { name: true, species: true } } },
    });
  }

  async listCertificatesByEmail(email: string) {
    return db.certificate.findMany({
      where: { recipientEmail: email },
      orderBy: { issuedAt: "desc" },
      take: 50,
    });
  }
}
