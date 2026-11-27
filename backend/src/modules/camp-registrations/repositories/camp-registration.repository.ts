/**
 * Prisma implementation of the camp registration repository — the ONLY place
 * in the camp-registrations module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import { BENEFICIARY_SELECT } from "./camp-registration.repository.interface";
import type {
  CampRegistrationCreateData,
  CampRegistrationDetailRow,
  CampRegistrationExisting,
  CampRegistrationListFilter,
  CampRegistrationListRow,
  CampRegistrationListScope,
  CampRegistrationRepository,
  CampRegistrationSavedRow,
  CampRegistrationUpdateData,
} from "./camp-registration.repository.interface";

export class PrismaCampRegistrationRepository implements CampRegistrationRepository {
  async findOrgIdByOwner(userId: string): Promise<string | null> {
    const org = await db.healthcareOrg.findUnique({ where: { ownerUserId: userId } });
    return org?.id ?? null;
  }

  async list(
    filter: CampRegistrationListFilter,
    scope: CampRegistrationListScope,
    skip: number,
    take: number
  ): Promise<{ rows: CampRegistrationListRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filter.campId) where.campId = filter.campId;
    if (filter.status) where.status = filter.status;
    if (filter.q) {
      where.beneficiary = {
        OR: [{ name: { contains: filter.q } }, { code: { contains: filter.q } }],
      };
    }
    if (scope.partnerOrgId) where.camp = { campPartners: { some: { orgId: scope.partnerOrgId } } };
    if (scope.beneficiaryId) where.beneficiaryId = scope.beneficiaryId;

    const [rows, total] = await Promise.all([
      db.campRegistration.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: { beneficiary: { select: BENEFICIARY_SELECT } },
      }),
      db.campRegistration.count({ where }),
    ]);
    return { rows: rows as CampRegistrationListRow[], total };
  }

  async findCampById(id: string): Promise<{ id: string; title: string; status: string; capacity: number } | null> {
    return db.medicalCamp.findUnique({
      where: { id },
      select: { id: true, title: true, status: true, capacity: true },
    });
  }

  async findBeneficiaryById(id: string): Promise<{ id: string; name: string } | null> {
    return db.beneficiary.findUnique({ where: { id }, select: { id: true, name: true } });
  }

  async findRegistrationByCampAndBeneficiary(campId: string, beneficiaryId: string): Promise<{ id: string } | null> {
    return db.campRegistration.findUnique({
      where: { campId_beneficiaryId: { campId, beneficiaryId } },
    });
  }

  async countActiveByCamp(campId: string): Promise<number> {
    // Capacity counts active registrations only (cancelled/rejected free a slot)
    return db.campRegistration.count({
      where: { campId, status: { notIn: ["CANCELLED", "REJECTED"] } },
    });
  }

  async findOwnBeneficiaryByUserId(userId: string): Promise<{ id: string } | null> {
    const own = await db.beneficiary.findFirst({ where: { userId }, select: { id: true } });
    return own ?? null;
  }

  async findBeneficiaryIdByUserId(userId: string): Promise<{ id: string } | null> {
    return db.beneficiary.findUnique({ where: { userId }, select: { id: true } });
  }

  async createRegistration(data: CampRegistrationCreateData): Promise<CampRegistrationSavedRow> {
    // Unique/FK-guarded: (campId, beneficiaryId) pair and code could race a
    // concurrent registration; camp/beneficiary references could be deleted.
    return mapPrismaError(() =>
      db.campRegistration.create({
        data: {
          campId: data.campId,
          beneficiaryId: data.beneficiaryId,
          code: data.code,
          status: "REGISTERED",
          registeredVia: data.registeredVia,
          scheduledSlot: data.scheduledSlot,
          notes: data.notes,
          registeredByName: data.registeredByName,
        },
        include: { beneficiary: { select: BENEFICIARY_SELECT } },
      })
    );
  }

  async findDetailById(id: string): Promise<CampRegistrationDetailRow | null> {
    const registration = await db.campRegistration.findUnique({
      where: { id },
      include: {
        beneficiary: {
          select: { id: true, code: true, name: true, phone: true, age: true, gender: true },
        },
        camp: { select: { id: true, code: true, title: true, status: true, venue: true, city: true } },
        attendance: true,
      },
    });
    return (registration as CampRegistrationDetailRow) ?? null;
  }

  async findExistingWithCamp(id: string): Promise<CampRegistrationExisting | null> {
    const registration = await db.campRegistration.findUnique({
      where: { id },
      include: { camp: { select: { code: true, title: true } } },
    });
    return (registration as CampRegistrationExisting) ?? null;
  }

  async updateRegistration(id: string, data: CampRegistrationUpdateData): Promise<CampRegistrationSavedRow> {
    return mapPrismaError(() =>
      db.campRegistration.update({
        where: { id },
        data,
        include: {
          beneficiary: {
            select: { id: true, code: true, name: true, phone: true, age: true, gender: true },
          },
        },
      })
    );
  }
}
