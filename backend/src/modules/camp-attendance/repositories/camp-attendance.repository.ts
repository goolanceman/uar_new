/**
 * Prisma implementation of the camp attendance repository — the ONLY place
 * in the camp-attendance module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  AttendanceCreateData,
  AttendanceListFilter,
  AttendanceListRow,
  AttendanceUpdateData,
  CampAttendanceRepository,
  CampAttendanceRow,
  CampScope,
  RegistrationWithCamp,
} from "./camp-attendance.repository.interface";

export class PrismaCampAttendanceRepository implements CampAttendanceRepository {
  async findOrgIdByOwner(userId: string): Promise<string | null> {
    const org = await db.healthcareOrg.findUnique({ where: { ownerUserId: userId } });
    return org?.id ?? null;
  }

  async campInScope(campId: string, scope?: CampScope): Promise<{ id: string } | null> {
    return db.medicalCamp.findFirst({
      where: { id: campId, ...(scope ?? {}) },
      select: { id: true },
    });
  }

  async countActiveRegistrations(campId: string): Promise<number> {
    return db.campRegistration.count({
      where: { campId, status: { notIn: ["CANCELLED", "REJECTED"] } },
    });
  }

  async attendanceStatusCounts(campId: string): Promise<Array<{ status: string; count: number }>> {
    const attGroup = await db.campAttendance.groupBy({
      by: ["status"],
      where: { campId },
      _count: { _all: true },
    });
    return attGroup.map((r) => ({ status: r.status, count: r._count._all }));
  }

  async list(
    filter: AttendanceListFilter,
    orgScope: CampScope | undefined,
    skip: number,
    take: number
  ): Promise<AttendanceListRow[]> {
    const where = this.whereFor(filter, orgScope);
    const items = await db.campAttendance.findMany({
      where,
      orderBy: [{ queueToken: "asc" }, { checkInAt: "asc" }],
      skip,
      take,
      include: {
        beneficiary: {
          select: { id: true, code: true, name: true, phone: true, age: true, gender: true },
        },
        registration: { select: { id: true, code: true, status: true } },
      },
    });
    return items as AttendanceListRow[];
  }

  async count(filter: AttendanceListFilter, orgScope: CampScope | undefined): Promise<number> {
    return db.campAttendance.count({ where: this.whereFor(filter, orgScope) });
  }

  private whereFor(filter: AttendanceListFilter, orgScope: CampScope | undefined) {
    const where: Record<string, unknown> = {};
    if (filter.campId) where.campId = filter.campId;
    if (filter.status) where.status = filter.status;
    if (orgScope) where.camp = orgScope;
    return where;
  }

  async findRegistrationFull(registrationId: string): Promise<RegistrationWithCamp | null> {
    return db.campRegistration.findUnique({
      where: { id: registrationId },
      include: { camp: true, attendance: true },
    }) as Promise<RegistrationWithCamp | null>;
  }

  async aggregateMaxQueueToken(campId: string): Promise<number | null> {
    const maxAgg = await db.campAttendance.aggregate({
      where: { campId },
      _max: { queueToken: true },
    });
    return maxAgg._max.queueToken;
  }

  /** registrationId is unique and its camp/beneficiary links are FKs — races
   *  map to 409s instead of raw 500s. */
  async create(data: AttendanceCreateData): Promise<CampAttendanceRow> {
    return mapPrismaError(() => db.campAttendance.create({ data }));
  }

  async findAttendanceWithRegistrationCode(
    id: string
  ): Promise<(CampAttendanceRow & { registration: { code: string } }) | null> {
    return db.campAttendance.findUnique({
      where: { id },
      include: { registration: { select: { code: true } } },
    }) as Promise<(CampAttendanceRow & { registration: { code: string } }) | null>;
  }

  async findDoctorById(id: string): Promise<{ id: string } | null> {
    return db.healthProfessional.findUnique({ where: { id }, select: { id: true } });
  }

  /** doctorId is an FK — a race with doctor deletion maps to a 409 instead
   *  of a raw 500. */
  async update(id: string, data: AttendanceUpdateData): Promise<CampAttendanceRow> {
    return mapPrismaError(() => db.campAttendance.update({ where: { id }, data }));
  }
}
