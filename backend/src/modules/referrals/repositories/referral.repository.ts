/**
 * Prisma implementation of the referral repository — the ONLY place in the
 * referrals module that touches Prisma models directly. Include shapes match
 * the legacy REFERRAL_INCLUDE / REFERRAL_ID_INCLUDE constants exactly so the
 * wire format is byte-identical.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CreateReferralData,
  ReferralListPage,
  ReferralListScope,
  ReferralRepository,
  UpdateReferralData,
} from "./referral.repository.interface";

const REFERRAL_INCLUDE = {
  beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
  camp: { select: { id: true, code: true, title: true } },
  encounter: { select: { id: true, status: true, diagnosis: true } },
  receivingOrg: { select: { id: true, name: true, type: true, city: true } },
} as const;

const REFERRAL_ID_INCLUDE = {
  beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
  camp: { select: { id: true, code: true, title: true } },
  receivingOrg: { select: { id: true, name: true, type: true, city: true } },
} as const;

export class PrismaReferralRepository implements ReferralRepository {
  async findOrgByOwner(ownerUserId: string): Promise<{ id: string; name: string } | null> {
    return db.healthcareOrg.findUnique({
      where: { ownerUserId },
      select: { id: true, name: true },
    });
  }

  async findOrgById(id: string): Promise<{ id: string } | null> {
    return db.healthcareOrg.findUnique({ where: { id }, select: { id: true } });
  }

  async findBeneficiaryByUser(userId: string): Promise<{ id: string } | null> {
    return db.beneficiary.findUnique({ where: { userId }, select: { id: true } });
  }

  async findBeneficiaryById(id: string): Promise<{ id: string; code: string } | null> {
    return db.beneficiary.findUnique({ where: { id }, select: { id: true, code: true } });
  }

  async findCampById(id: string): Promise<{ id: string } | null> {
    return db.medicalCamp.findUnique({ where: { id }, select: { id: true } });
  }

  async findEncounterById(id: string): Promise<{ id: string } | null> {
    return db.encounter.findUnique({ where: { id }, select: { id: true } });
  }

  async list(scope: ReferralListScope, skip: number, limit: number): Promise<ReferralListPage> {
    const where: Record<string, unknown> = {};
    if (scope.receivingOrgId) where.receivingOrgId = scope.receivingOrgId;
    if (scope.beneficiaryId) where.beneficiaryId = scope.beneficiaryId;
    if (scope.status) where.status = scope.status;
    if (scope.priority) where.priority = scope.priority;

    const [total, items] = await Promise.all([
      db.medicalReferral.count({ where }),
      db.medicalReferral.findMany({
        where,
        include: REFERRAL_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);
    return { items, total };
  }

  async findByIdWithFollowUps(id: string): Promise<unknown | null> {
    return db.medicalReferral.findUnique({
      where: { id },
      include: { ...REFERRAL_ID_INCLUDE, followUps: true },
    });
  }

  async findById(
    id: string
  ): Promise<{ id: string; code: string; status: string; receivingOrgId: string | null } | null> {
    return db.medicalReferral.findUnique({ where: { id } });
  }

  /** FK-guarded: camp/encounter/org references could race a concurrent delete. */
  async create(data: CreateReferralData): Promise<unknown> {
    return mapPrismaError(() =>
      db.medicalReferral.create({ data, include: REFERRAL_INCLUDE })
    );
  }

  async update(id: string, data: UpdateReferralData): Promise<unknown> {
    return mapPrismaError(() =>
      db.medicalReferral.update({ where: { id }, data, include: REFERRAL_ID_INCLUDE })
    );
  }
}
