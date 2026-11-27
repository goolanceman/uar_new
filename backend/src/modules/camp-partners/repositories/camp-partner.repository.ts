/**
 * Prisma implementation of the camp partner repository — the ONLY place in
 * the camp-partners module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CampPartnerListFilter,
  CampPartnerRepository,
  CampPartnerWithFullRefs,
  CampPartnerWithRefs,
} from "./camp-partner.repository.interface";

/** Reference shape attached to every partner the API returns (legacy INCLUDE). */
const INCLUDE = {
  camp: {
    select: { id: true, code: true, title: true, campDate: true, venue: true, city: true, status: true },
  },
  org: { select: { id: true, name: true, type: true, city: true, status: true } },
};

export class PrismaCampPartnerRepository implements CampPartnerRepository {
  async findOrgIdByOwner(userId: string): Promise<string | null> {
    const org = await db.healthcareOrg.findUnique({ where: { ownerUserId: userId } });
    return org?.id ?? null;
  }

  async list(
    filter: CampPartnerListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: CampPartnerWithRefs[]; total: number }> {
    const where: { campId?: string; status?: string; orgId?: string } = {};
    if (filter.campId) where.campId = filter.campId;
    if (filter.status) where.status = filter.status;
    if (filter.orgId) where.orgId = filter.orgId;

    const [rows, total] = await Promise.all([
      db.campPartner.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: INCLUDE,
      }),
      db.campPartner.count({ where }),
    ]);
    return { rows: rows as CampPartnerWithRefs[], total };
  }

  async findCampById(id: string): Promise<{ id: string; title: string } | null> {
    return db.medicalCamp.findUnique({ where: { id }, select: { id: true, title: true } });
  }

  async findOrgById(id: string): Promise<{ id: string; name: string } | null> {
    return db.healthcareOrg.findUnique({ where: { id }, select: { id: true, name: true } });
  }

  async findPartnerByCampAndOrg(campId: string, orgId: string): Promise<{ id: string } | null> {
    return db.campPartner.findFirst({ where: { campId, orgId }, select: { id: true } });
  }

  async createPartner(data: { campId: string; orgId: string; role: string }): Promise<CampPartnerWithRefs> {
    // Unique (campId, orgId) pair + camp/org FK references — mapped to the
    // shared 409 conflict the raw Prisma P2002/P2003 path would race into.
    return mapPrismaError(() =>
      db.campPartner.create({ data: { ...data, status: "INVITED" }, include: INCLUDE })
    ) as Promise<CampPartnerWithRefs>;
  }

  async findPartnerWithRefsById(id: string): Promise<CampPartnerWithFullRefs | null> {
    const partner = await db.campPartner.findUnique({
      where: { id },
      include: { camp: true, org: true },
    });
    return (partner as CampPartnerWithFullRefs) ?? null;
  }

  async updatePartner(
    id: string,
    data: { status?: string; notes?: string | null; respondedAt?: Date; role?: string }
  ): Promise<CampPartnerWithRefs> {
    return mapPrismaError(() =>
      db.campPartner.update({
        where: { id },
        data,
        include: INCLUDE,
      })
    ) as Promise<CampPartnerWithRefs>;
  }
}
