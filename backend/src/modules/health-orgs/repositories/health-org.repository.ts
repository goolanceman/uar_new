/**
 * Prisma implementation of the health org repository — the ONLY place in the
 * health-orgs module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { Prisma } from "@prisma/client";
import type {
  HealthOrgAdminListFilter,
  HealthOrgCreateData,
  HealthOrgDetailRow,
  HealthOrgDirectoryRow,
  HealthOrgExisting,
  HealthOrgListRow,
  HealthOrgRepository,
  HealthOrgWithPartnerCount,
} from "./health-org.repository.interface";

export class PrismaHealthOrgRepository implements HealthOrgRepository {
  async listAdmin(
    filter: HealthOrgAdminListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: HealthOrgListRow[]; total: number }> {
    const where: Prisma.HealthcareOrgWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    if (filter.q)
      where.OR = [
        { name: { contains: filter.q } },
        { city: { contains: filter.q } },
        { regNumber: { contains: filter.q } },
      ];
    if (filter.ownerUserId) where.ownerUserId = filter.ownerUserId;

    const [rows, total] = await Promise.all([
      db.healthcareOrg.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { staff: true, campPartners: true } },
        },
      }),
      db.healthcareOrg.count({ where }),
    ]);
    return { rows: rows as HealthOrgListRow[], total };
  }

  async listDoctorDirectory(
    q: string | undefined,
    type: string | undefined,
    skip: number,
    take: number
  ): Promise<{ rows: HealthOrgDirectoryRow[]; total: number }> {
    // Doctors pick a receiving org for referrals: verified orgs, directory fields only.
    const where: Prisma.HealthcareOrgWhereInput = { status: "VERIFIED" };
    if (type) where.type = type;
    if (q)
      where.OR = [
        { name: { contains: q } },
        { city: { contains: q } },
        { regNumber: { contains: q } },
      ];

    const [rows, total] = await Promise.all([
      db.healthcareOrg.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take,
        select: { id: true, name: true, type: true, city: true, status: true },
      }),
      db.healthcareOrg.count({ where }),
    ]);
    return { rows, total };
  }

  async createOrg(data: HealthOrgCreateData) {
    // Wrapped for symmetry: creation is FK-safe but keeps one error contract.
    return mapPrismaError(() =>
      db.healthcareOrg.create({
        data: {
          name: data.name,
          type: data.type,
          city: data.city,
          address: data.address,
          phone: data.phone,
          email: data.email,
          website: data.website,
          regNumber: data.regNumber,
          licences: data.licences,
          services: data.services,
          facilities: data.facilities,
          operatingHours: data.operatingHours,
          notes: data.notes,
          status: "PENDING",
        },
      })
    );
  }

  async findDetailById(id: string): Promise<HealthOrgDetailRow | null> {
    const org = await db.healthcareOrg.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        staff: { orderBy: { createdAt: "desc" } },
        _count: { select: { campPartners: true, referrals: true } },
      },
    });
    return (org as HealthOrgDetailRow) ?? null;
  }

  async findById(id: string): Promise<HealthOrgExisting | null> {
    return db.healthcareOrg.findUnique({
      where: { id },
      select: { id: true, ownerUserId: true, status: true },
    });
  }

  async findWithPartnerCount(id: string): Promise<HealthOrgWithPartnerCount | null> {
    const org = await db.healthcareOrg.findUnique({
      where: { id },
      include: { _count: { select: { campPartners: true } } },
    });
    return (org as HealthOrgWithPartnerCount) ?? null;
  }

  async updateOrg(id: string, data: Prisma.HealthcareOrgUpdateInput) {
    return mapPrismaError(() => db.healthcareOrg.update({ where: { id }, data }));
  }

  async detachProfessionals(id: string): Promise<void> {
    await db.healthProfessional.updateMany({ where: { orgId: id }, data: { orgId: null } });
  }

  async detachReferrals(id: string): Promise<void> {
    await db.medicalReferral.updateMany({ where: { receivingOrgId: id }, data: { receivingOrgId: null } });
  }

  async deleteOrg(id: string): Promise<void> {
    // FK-guarded: a partnership created after the pre-check would violate FKs.
    await mapPrismaError(() => db.healthcareOrg.delete({ where: { id } }));
  }
}
