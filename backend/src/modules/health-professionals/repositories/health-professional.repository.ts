/**
 * Prisma implementation of the health professional repository — the ONLY
 * place in the health-professionals module that touches Prisma models
 * directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { Prisma } from "@prisma/client";
import type {
  HealthProfessionalCreateData,
  HealthProfessionalDetailRow,
  HealthProfessionalExisting,
  HealthProfessionalListFilter,
  HealthProfessionalListRow,
  HealthProfessionalRepository,
  HealthProfessionalSavedRow,
} from "./health-professional.repository.interface";

export class PrismaHealthProfessionalRepository implements HealthProfessionalRepository {
  async findOrgIdByOwner(userId: string): Promise<string | null> {
    const org = await db.healthcareOrg.findUnique({ where: { ownerUserId: userId } });
    return org?.id ?? null;
  }

  async findOrgById(id: string): Promise<{ id: string } | null> {
    return db.healthcareOrg.findUnique({ where: { id }, select: { id: true } });
  }

  async list(
    filter: HealthProfessionalListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: HealthProfessionalListRow[]; total: number }> {
    const where: Prisma.HealthProfessionalWhereInput = {};
    if (filter.kind) where.kind = filter.kind;
    if (filter.orgId) where.orgId = filter.orgId;
    if (filter.verificationStatus) where.verificationStatus = filter.verificationStatus;
    if (filter.active === true) where.active = true;
    if (filter.active === false) where.active = false;
    if (filter.q)
      where.OR = [
        { name: { contains: filter.q } },
        { regNumber: { contains: filter.q } },
        { speciality: { contains: filter.q } },
        { phone: { contains: filter.q } },
      ];

    const [rows, total] = await Promise.all([
      db.healthProfessional.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          org: { select: { id: true, name: true, type: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      db.healthProfessional.count({ where }),
    ]);
    return { rows: rows as HealthProfessionalListRow[], total };
  }

  async findDetailById(id: string): Promise<HealthProfessionalDetailRow | null> {
    const professional = await db.healthProfessional.findUnique({
      where: { id },
      include: {
        org: { select: { id: true, name: true, type: true, city: true } },
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { campStaff: true, encounters: true, appointments: true } },
      },
    });
    return (professional as HealthProfessionalDetailRow) ?? null;
  }

  async findById(id: string): Promise<HealthProfessionalExisting | null> {
    return db.healthProfessional.findUnique({
      where: { id },
      select: { id: true, orgId: true, verificationStatus: true },
    });
  }

  async create(data: HealthProfessionalCreateData): Promise<HealthProfessionalSavedRow> {
    // FK-guarded: the org reference could race a concurrent delete.
    return mapPrismaError(() =>
      db.healthProfessional.create({
        data: {
          name: data.name,
          kind: data.kind,
          orgId: data.orgId,
          regNumber: data.regNumber,
          qualification: data.qualification,
          speciality: data.speciality,
          experienceYears: data.experienceYears,
          phone: data.phone,
          email: data.email,
          availability: data.availability,
          verificationStatus: "PENDING",
          active: true,
        },
        include: { org: { select: { id: true, name: true } } },
      })
    );
  }

  async update(id: string, data: Prisma.HealthProfessionalUpdateInput): Promise<HealthProfessionalSavedRow> {
    // Wrapped: org connect/disconnect could race a concurrent org delete.
    return mapPrismaError(() =>
      db.healthProfessional.update({
        where: { id },
        data,
        include: { org: { select: { id: true, name: true } } },
      })
    );
  }
}
