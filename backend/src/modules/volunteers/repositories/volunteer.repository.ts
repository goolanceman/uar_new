/**
 * Prisma implementation of the volunteer repository — the ONLY place in the
 * volunteers module that touches Prisma models directly. (No unique/FK
 * violation risk on any operation: no mapPrismaError wrap.)
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import type {
  VolunteerApplicationRow,
  VolunteerListFilter,
  VolunteerRepository,
  VolunteerRow,
  VolunteerUpdateData,
  VolunteerDetail,
  VolunteerWithTasks,
  VolunteerWithUser,
} from "./volunteer.repository.interface";

const ROSTER_INCLUDE = {
  user: { select: { name: true, email: true, phone: true, city: true } },
} satisfies Prisma.VolunteerInclude;

export class PrismaVolunteerRepository implements VolunteerRepository {
  async list(filter: VolunteerListFilter): Promise<VolunteerWithUser[]> {
    const volunteers = await db.volunteer.findMany({
      where: filter.status ? { status: filter.status } : {},
      orderBy: { joinedAt: "desc" },
      include: ROSTER_INCLUDE,
    });
    return volunteers as VolunteerWithUser[];
  }

  async listPaged(
    filter: VolunteerListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: VolunteerWithUser[]; total: number }> {
    const where: Prisma.VolunteerWhereInput = {};
    if (filter.status) where.status = filter.status;
    const [rows, total] = await Promise.all([
      db.volunteer.findMany({
        where,
        orderBy: { joinedAt: "desc" },
        skip,
        take,
        include: ROSTER_INCLUDE,
      }),
      db.volunteer.count({ where }),
    ]);
    return { rows: rows as VolunteerWithUser[], total };
  }

  async countPendingApplications(): Promise<number> {
    return db.volunteerApplication.count({ where: { status: "PENDING" } });
  }

  async listRosterSummaries(): Promise<Array<{ id: string; status: string; user: { name: string } }>> {
    return db.volunteer.findMany({
      select: {
        id: true,
        status: true,
        user: { select: { name: true } },
      },
    });
  }

  async listTaskSummaries(): Promise<Array<{ type: string; status: string; volunteerId: string }>> {
    return db.volunteerTask.findMany({
      select: { type: true, status: true, volunteerId: true },
    });
  }

  async listAttendanceSince(date: Date): Promise<Array<{ date: Date; hours: number | null }>> {
    return db.volunteerAttendance.findMany({
      where: { date: { gte: date } },
      select: { date: true, hours: true },
    });
  }

  async findByUserIdWithTasks(userId: string): Promise<VolunteerWithTasks | null> {
    return db.volunteer.findUnique({
      where: { userId },
      include: { tasks: { orderBy: { scheduledDate: "desc" } } },
    }) as Promise<VolunteerWithTasks | null>;
  }

  async findLatestApplication(userId: string): Promise<VolunteerApplicationRow | null> {
    return db.volunteerApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string): Promise<VolunteerRow | null> {
    return db.volunteer.findUnique({ where: { id } });
  }

  async findDetailById(id: string): Promise<VolunteerDetail | null> {
    return db.volunteer.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, city: true, status: true } },
        tasks: { orderBy: { scheduledDate: "desc" }, take: 50 },
        attendances: { orderBy: { date: "desc" }, take: 60 },
      },
    }) as Promise<VolunteerDetail | null>;
  }

  async update(id: string, data: VolunteerUpdateData): Promise<VolunteerRow> {
    return db.volunteer.update({ where: { id }, data });
  }
}
