/**
 * Prisma implementation of the auth repository — the ONLY place in the auth
 * module that touches Prisma models directly. The account-deletion cascade is
 * delegated to deleteUserCascade from the shared domain lib, exactly the
 * legacy call path.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import { deleteUserCascade } from "@/lib/community/users";
import type { PasswordReset, User } from "@prisma/client";
import type {
  AuthRepository,
  ProfilePatch,
  RegisteredUserData,
  SocialUserData,
} from "./auth.repository.interface";

export class PrismaAuthRepository implements AuthRepository {
  async findByEmail(email: string): Promise<User | null> {
    return db.user.findFirst({
      where: { email: { equals: email } },
    });
  }

  async findById(id: string): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  }

  async findByUsername(username: string): Promise<{ id: string } | null> {
    return db.user.findFirst({ where: { username }, select: { id: true } });
  }

  async listDemoAccountEmails(emails: string[]): Promise<{ email: string }[]> {
    return db.user.findMany({
      where: { email: { in: emails }, status: { not: "SUSPENDED" } },
      select: { email: true },
    });
  }

  async registerDevice(id: string, data: { deviceToken: string; deviceType: number | null }): Promise<User> {
    return mapPrismaError(() =>
      db.user.update({
        where: { id },
        data: {
          deviceToken: data.deviceToken,
          ...(data.deviceType !== null ? { deviceType: data.deviceType } : {}),
        },
      })
    );
  }

  async upgradePasswordHash(id: string, passwordHash: string): Promise<User> {
    return mapPrismaError(() => db.user.update({ where: { id }, data: { password: passwordHash } }));
  }

  async revokeTokens(id: string, when: Date): Promise<User> {
    return mapPrismaError(() => db.user.update({ where: { id }, data: { tokenValidAfter: when } }));
  }

  async updatePasswordAndRevoke(id: string, passwordHash: string, when: Date): Promise<User> {
    return mapPrismaError(() =>
      db.user.update({
        where: { id },
        data: { password: passwordHash, tokenValidAfter: when },
      })
    );
  }

  async markEmailVerified(id: string): Promise<User> {
    return mapPrismaError(() => db.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } }));
  }

  async updateDevice(id: string, data: { deviceType?: number; deviceToken?: string }): Promise<User> {
    return mapPrismaError(() =>
      db.user.update({
        where: { id },
        data: {
          ...(data.deviceType !== undefined ? { deviceType: data.deviceType } : {}),
          ...(data.deviceToken !== undefined ? { deviceToken: data.deviceToken } : {}),
        },
      })
    );
  }

  async createRegistered(data: RegisteredUserData): Promise<User> {
    return mapPrismaError(() =>
      db.user.create({
        data: {
          name: data.name,
          email: data.email,
          phone: data.phone,
          city: data.city,
          role: data.role,
          password: data.passwordHash,
          status: data.status,
          isActive: data.isActive,
          // Mobile signup may register its push credentials inline (web omits them).
          ...(data.device
            ? {
                deviceToken: data.device.deviceToken,
                ...(data.device.deviceType !== undefined ? { deviceType: data.device.deviceType } : {}),
              }
            : {}),
        },
      })
    );
  }

  async createSocial(data: SocialUserData): Promise<User> {
    return mapPrismaError(() =>
      db.user.create({
        data: {
          email: data.email,
          name: data.name,
          password: data.passwordHash,
          username: data.username,
          loginType: data.loginType,
          status: "ACTIVE",
          ...(data.deviceType !== undefined ? { deviceType: data.deviceType } : {}),
          ...(data.deviceToken !== undefined ? { deviceToken: data.deviceToken } : {}),
        },
      })
    );
  }

  async updateProfile(id: string, data: ProfilePatch): Promise<User> {
    return mapPrismaError(() => db.user.update({ where: { id }, data }));
  }

  async deleteUserCascade(userId: string): Promise<void> {
    return deleteUserCascade(userId);
  }

  async supersedePasswordResets(email: string): Promise<number> {
    const result = await db.passwordReset.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count;
  }

  async createPasswordReset(data: { email: string; otpHash: string; expiresAt: Date }): Promise<PasswordReset> {
    return mapPrismaError(() =>
      db.passwordReset.create({
        data: { email: data.email, otpHash: data.otpHash, expiresAt: data.expiresAt },
      })
    );
  }

  async findPendingOtpRows(email: string): Promise<PasswordReset[]> {
    return db.passwordReset.findMany({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  }

  async consumePasswordResets(email: string): Promise<number> {
    const result = await db.passwordReset.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count;
  }
}
