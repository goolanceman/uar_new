/**
 * Prisma implementation of the volunteer application repository — the ONLY
 * place in the volunteer-applications module that touches Prisma models
 * directly. Operations with unique/FK violation risk (account creation by
 * email, the approval Volunteer upsert) are wrapped in mapPrismaError.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  ApplicantUserData,
  ExistingUserSnapshot,
  SessionUserSnapshot,
  UserLinkData,
  UserMirrorData,
  VolunteerApplicationCreateData,
  VolunteerApplicationRepository,
  VolunteerApplicationRow,
  VolunteerApplicationUpdateData,
  VolunteerUpsertSpec,
} from "./volunteer-application.repository.interface";

export class PrismaVolunteerApplicationRepository implements VolunteerApplicationRepository {
  async listByUser(userId: string): Promise<VolunteerApplicationRow[]> {
    return db.volunteerApplication.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async listForAdmin(filter: { status?: string; q?: string }): Promise<VolunteerApplicationRow[]> {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.q) {
      where.OR = [
        { fullName: { contains: filter.q } },
        { email: { contains: filter.q } },
        { city: { contains: filter.q } },
      ];
    }
    return db.volunteerApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  async findUserById(id: string): Promise<SessionUserSnapshot | null> {
    return db.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, phone: true },
    });
  }

  async findUserByEmail(email: string): Promise<ExistingUserSnapshot | null> {
    return db.user.findFirst({
      where: { email: { equals: email } },
      select: { id: true, role: true },
    });
  }

  async linkExistingUser(id: string, data: UserLinkData) {
    return mapPrismaError(() =>
      db.user.update({
        where: { id },
        data,
      })
    );
  }

  async createApplicantUser(data: ApplicantUserData) {
    // Unique/FK-guarded: email is @unique and a concurrent application with
    // the same address could race the findFirst check above.
    return mapPrismaError(() =>
      db.user.create({
        data,
      })
    );
  }

  async findApplicationById(id: string): Promise<VolunteerApplicationRow | null> {
    return db.volunteerApplication.findUnique({ where: { id } });
  }

  async findLatestByUser(userId: string): Promise<VolunteerApplicationRow | null> {
    return db.volunteerApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async createApplication(data: VolunteerApplicationCreateData): Promise<VolunteerApplicationRow> {
    return mapPrismaError(() => db.volunteerApplication.create({ data }));
  }

  async updateApplication(
    id: string,
    data: VolunteerApplicationUpdateData
  ): Promise<VolunteerApplicationRow> {
    return mapPrismaError(() => db.volunteerApplication.update({ where: { id }, data }));
  }

  async deleteApplication(id: string): Promise<void> {
    await db.volunteerApplication.delete({ where: { id } });
  }

  async updateUser(id: string, data: UserMirrorData) {
    return mapPrismaError(() => db.user.update({ where: { id }, data }));
  }

  async updateUserOrIgnore(id: string, data: UserMirrorData): Promise<void> {
    await db.user
      .update({
        where: { id },
        data,
      })
      .catch(() => undefined); // applicant row may already be gone
  }

  async findVolunteerByUserId(userId: string) {
    return db.volunteer.findUnique({ where: { userId } });
  }

  async upsertVolunteerForApproval(userId: string, spec: VolunteerUpsertSpec) {
    // Unique/FK-guarded: Volunteer.code and Volunteer.userId are @unique and
    // the user reference is an FK — a concurrent approval could race here.
    return mapPrismaError(() =>
      db.volunteer.upsert({
        where: { userId },
        create: spec.create,
        update: spec.update,
      })
    );
  }
}
