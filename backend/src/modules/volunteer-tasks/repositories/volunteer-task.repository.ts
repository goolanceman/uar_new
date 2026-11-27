/**
 * Prisma implementation of the volunteer task repository — the ONLY place in
 * the volunteer-tasks module that touches Prisma models directly.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CreateVolunteerTaskData,
  UpdateVolunteerTaskData,
  VolunteerTaskListFilter,
  VolunteerTaskRepository,
  VolunteerTaskRow,
  VolunteerTaskWithVolunteer,
} from "./volunteer-task.repository.interface";

const TASK_INCLUDE = {
  volunteer: { include: { user: { select: { name: true } } } },
} satisfies Prisma.VolunteerTaskInclude;

export class PrismaVolunteerTaskRepository implements VolunteerTaskRepository {
  async findVolunteerByUserId(userId: string): Promise<{ id: string } | null> {
    return db.volunteer.findUnique({ where: { userId }, select: { id: true } });
  }

  async findVolunteerByIdWithUser(id: string): Promise<{ id: string; user: { name: string } } | null> {
    return db.volunteer.findUnique({
      where: { id },
      include: { user: { select: { name: true } } },
    });
  }

  async listByVolunteer(volunteerId: string): Promise<VolunteerTaskRow[]> {
    return db.volunteerTask.findMany({
      where: { volunteerId },
      orderBy: { scheduledDate: "desc" },
    });
  }

  private whereFor(filter: VolunteerTaskListFilter): Prisma.VolunteerTaskWhereInput {
    const where: Prisma.VolunteerTaskWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    if (filter.volunteerId) where.volunteerId = filter.volunteerId;
    if (filter.refType) where.refType = filter.refType;
    if (filter.refId) where.refId = filter.refId;
    if (filter.q)
      where.OR = [
        { title: { contains: filter.q } },
        { location: { contains: filter.q } },
        { description: { contains: filter.q } },
      ];
    return where;
  }

  async list(filter: VolunteerTaskListFilter): Promise<VolunteerTaskWithVolunteer[]> {
    const tasks = await db.volunteerTask.findMany({
      where: this.whereFor(filter),
      orderBy: { scheduledDate: "desc" },
      include: TASK_INCLUDE,
    });
    return tasks as VolunteerTaskWithVolunteer[];
  }

  async listPaged(
    filter: VolunteerTaskListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: VolunteerTaskWithVolunteer[]; total: number }> {
    const where = this.whereFor(filter);
    const [rows, total] = await Promise.all([
      db.volunteerTask.findMany({
        where,
        orderBy: { scheduledDate: "desc" },
        include: TASK_INCLUDE,
        skip,
        take,
      }),
      db.volunteerTask.count({ where }),
    ]);
    return { rows: rows as VolunteerTaskWithVolunteer[], total };
  }

  async findTaskById(id: string): Promise<VolunteerTaskRow | null> {
    return db.volunteerTask.findUnique({ where: { id } });
  }

  /** volunteerId is an FK — a race with volunteer deletion maps to a 409
   *  instead of a raw 500. */
  async create(data: CreateVolunteerTaskData): Promise<VolunteerTaskRow> {
    return mapPrismaError(() => db.volunteerTask.create({ data }));
  }

  async update(id: string, data: UpdateVolunteerTaskData): Promise<VolunteerTaskRow> {
    return db.volunteerTask.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await db.volunteerTask.delete({ where: { id } });
  }
}
