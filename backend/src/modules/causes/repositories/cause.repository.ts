/**
 * Prisma implementation of the cause repository — the ONLY place in the
 * causes module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { Prisma } from "@prisma/client";
import type {
  CauseListFilter,
  CauseRepository,
  CreateCauseData,
  CreatePledgeData,
  PledgeListFilter,
  UpdateCauseData,
} from "./cause.repository.interface";

export class PrismaCauseRepository implements CauseRepository {
  private whereFor(filter: CauseListFilter): Prisma.CauseWhereInput {
    const where: Prisma.CauseWhereInput = {};
    if (filter.condition) where.condition = filter.condition;
    if (filter.status) where.status = filter.status;
    if (filter.q)
      where.OR = [
        { patientName: { contains: filter.q } },
        { city: { contains: filter.q } },
        { code: { contains: filter.q } },
      ];
    return where;
  }

  async list(filter: CauseListFilter) {
    return db.cause.findMany({
      where: this.whereFor(filter),
      orderBy: { createdAt: "desc" },
      include: {
        pledges: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            donorName: true,
            amountPerMonth: true,
            months: true,
            status: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  async listPledges(filter: PledgeListFilter) {
    const where: Prisma.PledgeWhereInput = {};
    if (filter.donorId) where.donorId = filter.donorId;
    if (filter.causeId) where.causeId = filter.causeId;
    return db.pledge.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        cause: {
          select: {
            code: true,
            patientName: true,
            condition: true,
            monthlyCost: true,
          },
        },
      },
    });
  }

  async listDonationsByPledgeIds(ids: string[]) {
    if (!ids.length) return [];
    return db.donation.findMany({ where: { pledgeId: { in: ids } } });
  }

  async count(): Promise<number> {
    return db.cause.count();
  }

  async findByCode(code: string) {
    return db.cause.findUnique({ where: { code } });
  }

  async create(data: CreateCauseData) {
    // code UAR-MED-0001 — unique across causes.
    return mapPrismaError(() => db.cause.create({ data }));
  }

  async findDetailById(id: string) {
    return db.cause.findUnique({
      where: { id },
      include: { pledges: { orderBy: { createdAt: "desc" } } },
    });
  }

  async findById(id: string) {
    return db.cause.findUnique({ where: { id } });
  }

  async update(id: string, data: UpdateCauseData) {
    return db.cause.update({ where: { id }, data });
  }

  async deletePledges(causeId: string): Promise<number> {
    const result = await db.pledge.deleteMany({ where: { causeId } });
    return result.count;
  }

  async remove(id: string): Promise<void> {
    await mapPrismaError(() => db.cause.delete({ where: { id } }));
  }

  async createPledge(data: CreatePledgeData) {
    // Pledge.causeId is a required relation (FK) — mapped at the boundary.
    return mapPrismaError(() => db.pledge.create({ data }));
  }
}
