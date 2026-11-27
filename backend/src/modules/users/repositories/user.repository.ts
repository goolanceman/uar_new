/**
 * Prisma implementation of the user (admin directory) repository — the ONLY
 * place in the users module that touches Prisma models directly. The full
 * community cascade is delegated to deleteUserCascade from the shared domain
 * lib, exactly the legacy call path.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import { deleteUserCascade } from "@/domains/community/users";
import type {
  CreateUserAccess,
  CreatedUserRow,
  UpdateUserData,
  UserListFilters,
  UserRepository,
  UserRow,
} from "./user.repository.interface";

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  isActive: true,
  phone: true,
  city: true,
  pan: true,
  about: true,
  avatar: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaUserRepository implements UserRepository {
  async list(filters: UserListFilters): Promise<UserRow[]> {
    const where: Record<string, unknown> = {};
    if (filters.role) where.role = filters.role;
    if (filters.status) where.status = filters.status;
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q } },
        { email: { contains: filters.q } },
        { phone: { contains: filters.q } },
        { city: { contains: filters.q } },
      ];
    }

    return db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: userSelect,
    });
  }

  async findByEmail(email: string): Promise<{ id: string } | null> {
    return db.user.findFirst({
      where: { email: { equals: email } },
      select: { id: true },
    });
  }

  async findByEmailExcluding(email: string, id: string): Promise<{ id: string } | null> {
    return db.user.findFirst({ where: { email, id: { not: id } }, select: { id: true } });
  }

  async findById(id: string): Promise<UserRow | null> {
    return db.user.findUnique({ where: { id }, select: userSelect });
  }

  async findFullById(id: string): Promise<{ id: string; role: string; email: string } | null> {
    return db.user.findUnique({ where: { id }, select: { id: true, role: true, email: true } });
  }

  async countAdmins(): Promise<number> {
    return db.user.count({ where: { role: "ADMIN" } });
  }

  /** email is unique — a concurrent create maps to a 409 instead of a raw 500. */
  async create(data: CreateUserAccess): Promise<CreatedUserRow> {
    return mapPrismaError(() =>
      db.user.create({
        data: {
          name: data.name,
          email: data.email,
          password: data.passwordHash,
          role: data.role,
          phone: data.phone,
          city: data.city,
          about: data.about,
          status: data.status,
          isActive: data.isActive,
        },
      })
    );
  }

  async update(
    id: string,
    data: UpdateUserData
  ): Promise<{ id: string; email: string; password: string; [key: string]: unknown }> {
    return mapPrismaError(() => db.user.update({ where: { id }, data }));
  }

  async listActivity(userId: string, take: number): Promise<unknown[]> {
    return db.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  /** Detach CRM children that point back at the user before the cascade. */
  async detachDonations(userId: string): Promise<void> {
    await db.donation.updateMany({ where: { donorId: userId }, data: { donorId: null } });
  }

  async detachActivityLogs(userId: string): Promise<void> {
    await db.activityLog.updateMany({ where: { userId }, data: { userId: null } });
  }

  async detachBeneficiaries(userId: string): Promise<void> {
    await db.beneficiary.updateMany({ where: { userId }, data: { userId: null } });
  }

  /** Full community cascade — deletes the user row and their notifications +
   *  volunteer profile (shared domain lib, the legacy call path). */
  async deleteUserCascade(userId: string): Promise<void> {
    return deleteUserCascade(userId);
  }
}
