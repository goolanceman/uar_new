/**
 * Prisma implementation of the volunteer attendance repository — the ONLY
 * place in the volunteer-attendances module that touches Prisma models
 * directly.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  AttendanceCheckInData,
  AttendanceListFilter,
  AttendanceRow,
  AttendanceUpsertData,
  AttendanceWithVolunteer,
  VolunteerAttendanceRepository,
  VolunteerRef,
} from "./volunteer-attendance.repository.interface";

export class PrismaVolunteerAttendanceRepository implements VolunteerAttendanceRepository {
  async findVolunteerByUserId(userId: string): Promise<VolunteerRef | null> {
    return db.volunteer.findUnique({ where: { userId }, select: { id: true, status: true } });
  }

  async findVolunteerById(id: string): Promise<VolunteerRef | null> {
    return db.volunteer.findUnique({ where: { id }, select: { id: true, status: true } });
  }

  async findTaskForVolunteer(
    taskId: string,
    volunteerId: string
  ): Promise<{ title: string; location: string | null } | null> {
    return db.volunteerTask.findFirst({
      where: { id: taskId, volunteerId },
      select: { title: true, location: true },
    });
  }

  async list(filter: AttendanceListFilter): Promise<AttendanceWithVolunteer[]> {
    const where: Prisma.VolunteerAttendanceWhereInput = {};
    if (filter.volunteerId) where.volunteerId = filter.volunteerId;
    if (filter.from || filter.to) {
      where.date = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }

    const rows = await db.volunteerAttendance.findMany({
      where,
      orderBy: { date: "desc" },
      take: filter.limit,
      include: {
        volunteer: {
          select: {
            id: true,
            assignedArea: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });
    return rows as AttendanceWithVolunteer[];
  }

  async findAttendanceByVolunteerAndDate(volunteerId: string, date: Date): Promise<AttendanceRow | null> {
    return db.volunteerAttendance.findUnique({
      where: { volunteerId_date: { volunteerId, date } },
    });
  }

  async updateAttendance(id: string, data: AttendanceCheckInData): Promise<AttendanceRow> {
    return db.volunteerAttendance.update({ where: { id }, data });
  }

  /** @@unique([volunteerId, date]) — a concurrent check-in maps to a 409. */
  async createAttendance(
    data: AttendanceCheckInData & { volunteerId: string; date: Date }
  ): Promise<AttendanceRow> {
    return mapPrismaError(() => db.volunteerAttendance.create({ data }));
  }

  async upsertAttendance(
    volunteerId: string,
    date: Date,
    data: AttendanceUpsertData
  ): Promise<AttendanceRow> {
    return mapPrismaError(() =>
      db.volunteerAttendance.upsert({
        where: { volunteerId_date: { volunteerId, date } },
        create: { volunteerId, date, ...data },
        update: data,
      })
    );
  }
}
