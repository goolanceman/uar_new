/**
 * User service (admin directory) — all business rules for /api/users.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. Field checks keep their exact legacy messages and sequential
 * ordering (required → role → email → password → duplicates → last-admin
 * guards), including the 404-before-400 interleaving with DB lookups.
 */
import { logger } from "@/infrastructure/logging/logger";
import { hashPassword, logActivity, type Session } from "@/infrastructure/auth/session";
import { USER_STATUSES } from "@/domains/user-status";
import { ApiError, NotFoundError, ConflictError } from "@/shared/errors";
import type {
  CreateUserAccess,
  UpdateUserData,
  UserRepository,
} from "../repositories/user.repository.interface";
import type { ListUsersQuery } from "../schemas/user.schema";

const log = logger.child("users");

const ROLES = ["ADMIN", "VOLUNTEER", "DONOR", "BENEFICIARY"];
const STATUSES: readonly string[] = USER_STATUSES;

export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  /** GET /api/users?q&role&status — admin directory (newest first). */
  async list(query: ListUsersQuery): Promise<unknown[]> {
    const q = query.q?.trim();
    return this.userRepository.list({
      q: q || undefined,
      role: query.role,
      status: query.status,
    });
  }

  /** POST /api/users — admin creates a user. */
  async create(body: Record<string, unknown>, session: Session): Promise<Record<string, unknown>> {
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const role = String(body?.role ?? "DONOR");
    const phone = body?.phone ? String(body.phone).trim() : null;
    const city = body?.city ? String(body.city).trim() : null;
    const about = body?.about ? String(body.about) : null;

    if (!name || !email || !password || !role)
      throw new ApiError("Name, email, password and role are required", 400);
    if (!ROLES.includes(role)) throw new ApiError("Invalid role", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);
    if (password.length < 6)
      throw new ApiError("Password must be at least 6 characters", 400);

    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      log.warn("user_email_conflict", { email, actor: session.userId });
      throw new ConflictError("An account with this email already exists");
    }

    const data: CreateUserAccess = {
      name,
      email,
      passwordHash: hashPassword(password),
      role,
      phone,
      city,
      about,
      status: role === "VOLUNTEER" ? "PENDING" : "ACTIVE",
      isActive: role !== "VOLUNTEER",
    };
    const user = await this.userRepository.create(data);

    log.info("user_created", {
      userId: user.id,
      email: user.email,
      role,
      status: String(user.status),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "USER_CREATE",
      "USER",
      `${user.email} (${role})`,
      session.userId
    );

    const { password: _pw, ...userSafe } = user;
    return userSafe;
  }

  /**
   * GET /api/users/:id (ADMIN) — full record + recent audit-trail entries for
   * the detail sheet's Activity tab.
   */
  async get(id: string): Promise<{ user: unknown; activityLogs: unknown[] }> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundError("User not found");

    const activityLogs = await this.userRepository.listActivity(id, 30);
    return { user, activityLogs };
  }

  /** PATCH /api/users/:id — admin edits a user. */
  async update(
    id: string,
    body: Record<string, unknown>,
    session: Session
  ): Promise<Record<string, unknown>> {
    const target = await this.userRepository.findFullById(id);
    if (!target) {
      log.warn("user_update_not_found", { userId: id, actor: session.userId });
      throw new NotFoundError("User not found");
    }

    const data: UpdateUserData = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("Name cannot be empty", 400);
      data.name = name;
    }
    if (body?.role !== undefined) {
      const role = String(body.role);
      if (!ROLES.includes(role)) throw new ApiError("Invalid role", 400);
      // Guard: never demote the last remaining ADMIN out of the console.
      if (target.role === "ADMIN" && role !== "ADMIN") {
        const adminCount = await this.userRepository.countAdmins();
        if (adminCount <= 1) {
          log.warn("user_last_admin_demotion_blocked", {
            userId: id,
            newRole: role,
            actor: session.userId,
          });
          throw new ConflictError("You cannot change the role of the only administrator");
        }
      }
      data.role = role;
    }
    if (body?.status !== undefined) {
      const status = String(body.status);
      if (!STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
    }
    if (body?.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email))
        throw new ApiError("Please enter a valid email address", 400);
      const taken = await this.userRepository.findByEmailExcluding(email, id);
      if (taken) {
        log.warn("user_email_conflict", { userId: id, email, actor: session.userId });
        throw new ConflictError("Another account already uses this email");
      }
      data.email = email;
    }
    if (body?.phone !== undefined) data.phone = body.phone ? String(body.phone).trim() : null;
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.pan !== undefined) {
      const v = body.pan ? String(body.pan).trim().toUpperCase() : null;
      if (v && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v))
        throw new ApiError("PAN must look like ABCDE1234F", 400);
      data.pan = v;
    }
    if (body?.about !== undefined) data.about = body.about ? String(body.about) : null;
    if (body?.avatar !== undefined) data.avatar = body.avatar ? String(body.avatar) : null;
    if (body?.password) {
      const pw = String(body.password);
      if (pw.length < 6)
        throw new ApiError("Password must be at least 6 characters", 400);
      data.password = hashPassword(pw);
    }

    // Status drives isActive: PENDING → false, ACTIVE → true, SUSPENDED → false
    if (body?.status !== undefined) {
      const status = String(body.status);
      data.status = status;
      if (body?.isActive === undefined) data.isActive = status === "ACTIVE";
    }
    if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive);

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    // Guard: an admin cannot lock themselves out of the console.
    if (data.isActive === false && id === session.userId) {
      log.warn("user_self_deactivation_blocked", { userId: id, actor: session.userId });
      throw new ConflictError("You cannot deactivate your own account");
    }
    const user = await this.userRepository.update(id, data);
    log.info("user_updated", {
      userId: id,
      email: user.email,
      fields: Object.keys(data),
      ...(data.status !== undefined ? { newStatus: String(data.status) } : {}),
      ...(data.role !== undefined ? { newRole: String(data.role) } : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      data.password ? "PASSWORD_RESET" : "USER_UPDATE",
      "USER",
      `${user.email} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    const { password: _pw, ...userSafe } = user;
    return userSafe;
  }

  /**
   * DELETE /api/users/:id — admin removes a user (community cascade via
   * deleteUserCascade — likes, follows, rooms, reels, posts, stories,
   * verifications, reports, saved notifications — plus the CRM detachments the
   * admin flow needs: donations, activity logs, beneficiary/donor profiles).
   */
  async remove(id: string, session: Session): Promise<{ ok: boolean }> {
    if (id === session.userId) {
      log.warn("user_self_delete_blocked", { userId: id, actor: session.userId });
      throw new ConflictError("You cannot delete your own account");
    }

    const target = await this.userRepository.findFullById(id);
    if (!target) {
      log.warn("user_delete_not_found", { userId: id, actor: session.userId });
      throw new NotFoundError("User not found");
    }

    if (target.role === "ADMIN") {
      const adminCount = await this.userRepository.countAdmins();
      if (adminCount <= 1) {
        log.warn("user_last_admin_delete_blocked", { userId: id, actor: session.userId });
        throw new ConflictError("You cannot delete the only administrator account");
      }
    }

    // Detach CRM children that point back at the user before the cascade.
    await this.userRepository.detachDonations(id);
    await this.userRepository.detachActivityLogs(id);
    await this.userRepository.detachBeneficiaries(id);

    // Full community cascade (also deletes the user row and their
    // notifications + volunteer profile).
    await this.userRepository.deleteUserCascade(id);
    log.info("user_deleted", {
      userId: id,
      email: target.email,
      role: target.role,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "USER_DELETE",
      "USER",
      `${target.email} (${target.role})`,
      session.userId
    );

    return { ok: true };
  }
}
