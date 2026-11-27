/**
 * Prisma implementation of the volunteer assignment repository — the ONLY
 * place in the volunteer-assignments module that touches Prisma models
 * directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CreateVolunteerTaskData,
  VolunteerAssignmentRepository,
  VolunteerRefRow,
  VolunteerTaskRow,
  VolunteerTaskWithVolunteer,
} from "./volunteer-assignment.repository.interface";

export class PrismaVolunteerAssignmentRepository implements VolunteerAssignmentRepository {
  async listTasksByRef(refType: string, refId: string): Promise<VolunteerTaskWithVolunteer[]> {
    const tasks = await db.volunteerTask.findMany({
      where: { refType, refId },
      orderBy: { createdAt: "desc" },
      include: {
        volunteer: {
          select: {
            id: true,
            status: true,
            assignedArea: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });
    return tasks as VolunteerTaskWithVolunteer[];
  }

  async findDistributionById(id: string): Promise<{ id: string } | null> {
    return db.distribution.findUnique({ where: { id }, select: { id: true } });
  }

  async findCampaignById(id: string): Promise<{ id: string; title: string } | null> {
    return db.campaign.findUnique({ where: { id }, select: { id: true, title: true } });
  }

  async findVolunteersByIds(ids: string[]): Promise<VolunteerRefRow[]> {
    return db.volunteer.findMany({
      where: { id: { in: ids } },
      include: { user: { select: { name: true } } },
    }) as Promise<VolunteerRefRow[]>;
  }

  async findExistingTaskVolunteerIds(
    refType: string,
    refId: string,
    volunteerIds: string[]
  ): Promise<string[]> {
    const existing = await db.volunteerTask.findMany({
      where: {
        refType,
        refId,
        volunteerId: { in: volunteerIds },
        status: { not: "CANCELLED" },
      },
      select: { volunteerId: true },
    });
    return existing.map((e) => e.volunteerId);
  }

  async createTask(data: CreateVolunteerTaskData): Promise<VolunteerTaskRow> {
    // volunteerId is a required FK — a race past the service's volunteer
    // existence check maps to the shared 409 instead of a raw Prisma error.
    return mapPrismaError(() => db.volunteerTask.create({ data }) as Promise<VolunteerTaskRow>);
  }
}
