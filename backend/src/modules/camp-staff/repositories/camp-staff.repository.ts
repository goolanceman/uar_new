/**
 * Prisma implementation of the camp staff repository — the ONLY place in the
 * camp-staff module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CampStaffCreateData,
  CampStaffCreatedRow,
  CampStaffListFilter,
  CampStaffListRow,
  CampStaffRepository,
  CampStaffUpdatedRow,
  CampStaffWithProfessionalName,
  CampStaffWithRefs,
} from "./camp-staff.repository.interface";

export class PrismaCampStaffRepository implements CampStaffRepository {
  async findCampById(id: string): Promise<{ id: string; title: string } | null> {
    return db.medicalCamp.findUnique({ where: { id }, select: { id: true, title: true } });
  }

  async findOrgIdByOwner(userId: string): Promise<string | null> {
    const org = await db.healthcareOrg.findUnique({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    return org?.id ?? null;
  }

  async findAcceptedPartner(campId: string, orgId: string): Promise<{ id: string } | null> {
    return db.campPartner.findFirst({
      where: { campId, orgId, status: "ACCEPTED" },
      select: { id: true },
    });
  }

  async findProfessionalInOrg(professionalId: string, orgId: string): Promise<{ id: string } | null> {
    return db.healthProfessional.findFirst({
      where: { id: professionalId, orgId },
      select: { id: true },
    });
  }

  async findProfessionalById(id: string): Promise<{ id: string; kind: string; verificationStatus: string } | null> {
    return db.healthProfessional.findUnique({
      where: { id },
      select: { id: true, kind: true, verificationStatus: true },
    });
  }

  async findVolunteerById(id: string): Promise<{ id: string } | null> {
    return db.volunteer.findUnique({ where: { id }, select: { id: true } });
  }

  async createStaff(data: CampStaffCreateData): Promise<CampStaffCreatedRow> {
    // FK-guarded: camp/professional references could race a concurrent delete.
    return mapPrismaError(() =>
      db.campStaff.create({
        data: {
          campId: data.campId,
          professionalId: data.professionalId,
          volunteerId: data.volunteerId,
          role: data.role,
          status: "ASSIGNED",
          notes: data.notes,
        },
        include: {
          professional: {
            select: { id: true, name: true, kind: true, speciality: true, verificationStatus: true },
          },
        },
      })
    );
  }

  async list(
    filter: CampStaffListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: CampStaffListRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filter.campId) where.campId = filter.campId;
    if (filter.status) where.status = filter.status;

    const [rows, total] = await Promise.all([
      db.campStaff.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          professional: {
            select: { id: true, name: true, kind: true, speciality: true, verificationStatus: true },
          },
          camp: { select: { id: true, code: true, title: true, status: true } },
        },
      }),
      db.campStaff.count({ where }),
    ]);
    return { rows: rows as CampStaffListRow[], total };
  }

  async findStaffWithProfessional(id: string): Promise<CampStaffWithProfessionalName | null> {
    const staff = await db.campStaff.findUnique({
      where: { id },
      include: { professional: { select: { name: true } } },
    });
    return (staff as CampStaffWithProfessionalName) ?? null;
  }

  async deleteStaff(id: string): Promise<void> {
    await db.campStaff.delete({ where: { id } });
  }

  async findStaffWithRefs(id: string): Promise<CampStaffWithRefs | null> {
    const staff = await db.campStaff.findUnique({
      where: { id },
      include: {
        professional: { select: { name: true } },
        camp: { select: { title: true } },
      },
    });
    return (staff as CampStaffWithRefs) ?? null;
  }

  async updateStatusGuarded(id: string, expectedStatus: string, status: string): Promise<number> {
    const result = await db.campStaff.updateMany({
      where: { id, status: expectedStatus },
      data: { status },
    });
    return result.count;
  }

  async findStaffWithProfessionalInclude(id: string): Promise<CampStaffUpdatedRow> {
    return db.campStaff.findUniqueOrThrow({
      where: { id },
      include: {
        professional: { select: { id: true, name: true, kind: true, speciality: true } },
      },
    });
  }
}
