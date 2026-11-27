/**
 * Prisma implementation of the follow-up repository — the ONLY place in the
 * follow-ups module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { Prisma } from "@prisma/client";
import type {
  FollowUpCreateData,
  FollowUpListWhere,
  FollowUpRepository,
  FollowUpRow,
  FollowUpUpdateData,
  FollowUpUpdateRow,
} from "./follow-up.repository.interface";

export class PrismaFollowUpRepository implements FollowUpRepository {
  async findBeneficiaryIdByUserId(userId: string): Promise<string | null> {
    const own = await db.beneficiary.findUnique({
      where: { userId },
      select: { id: true },
    });
    return own?.id ?? null;
  }

  async findBeneficiaryRef(id: string): Promise<{ id: string; code: string } | null> {
    return db.beneficiary.findUnique({ where: { id }, select: { id: true, code: true } });
  }

  async findCampRef(id: string): Promise<{ id: string } | null> {
    return db.medicalCamp.findUnique({ where: { id }, select: { id: true } });
  }

  async findReferralRef(id: string): Promise<{ id: string } | null> {
    return db.medicalReferral.findUnique({ where: { id }, select: { id: true } });
  }

  async listFollowUps(
    where: FollowUpListWhere,
    skip: number,
    take: number,
    overdueOnly: boolean
  ): Promise<{ rows: FollowUpRow[]; total: number }> {
    const prismaWhere: Prisma.FollowUpWhereInput = {};
    if (where.beneficiaryId) prismaWhere.beneficiaryId = where.beneficiaryId;
    if (where.status) prismaWhere.status = where.status;
    if (where.dueBefore) prismaWhere.dueDate = { lt: where.dueBefore };

    const [total, rows] = await Promise.all([
      db.followUp.count({ where: prismaWhere }),
      db.followUp.findMany({
        where: prismaWhere,
        include: {
          beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
          camp: { select: { id: true, code: true, title: true } },
          referral: { select: { id: true, code: true, status: true, priority: true } },
        },
        orderBy: overdueOnly ? { dueDate: "asc" } : { createdAt: "desc" },
        skip,
        take,
      }),
    ]);
    return { rows: rows as FollowUpRow[], total };
  }

  async findFollowUpById(id: string): Promise<FollowUpRow | null> {
    return db.followUp.findUnique({
      where: { id },
      include: {
        beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
        camp: { select: { id: true, code: true, title: true } },
        referral: { select: { id: true, code: true, status: true, priority: true } },
      },
    }) as Promise<FollowUpRow | null>;
  }

  async findFollowUpPlain(id: string): Promise<{ id: string; status: string } | null> {
    return db.followUp.findUnique({ where: { id }, select: { id: true, status: true } });
  }

  async createFollowUp(data: FollowUpCreateData): Promise<FollowUpRow> {
    return mapPrismaError(() =>
      db.followUp.create({
        data,
        include: {
          beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
          camp: { select: { id: true, code: true, title: true } },
          referral: { select: { id: true, code: true, status: true, priority: true } },
        },
      })
    ) as Promise<FollowUpRow>;
  }

  async updateFollowUp(id: string, data: FollowUpUpdateData): Promise<FollowUpUpdateRow> {
    return mapPrismaError(() =>
      db.followUp.update({
        where: { id },
        data,
        include: {
          beneficiary: { select: { id: true, code: true, name: true } },
          camp: { select: { id: true, code: true, title: true } },
          referral: { select: { id: true, code: true, status: true } },
        },
      })
    );
  }
}
