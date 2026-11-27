/**
 * Profile service — self-service profile flows for /api/profile*. Depends on
 * the repository contract, throws application errors, never touches HTTP.
 *
 * Field checks keep their exact legacy messages and sequential ordering —
 * including the interleaving with DB lookups (username-conflict check,
 * verification state gates, account 404s) and with the asset uploads (files
 * are persisted only after the earlier field checks pass), plus the
 * "Nothing to update" 400 that comes AFTER file handling in the PATCH flow.
 */
import { logger } from "@/infrastructure/logging/logger";
import { communityUser } from "@/domains/community/serializers";
import { saveUpload } from "@/domains/files";
import { hashPassword, logActivity, verifyPassword, type Session } from "@/infrastructure/auth/session";
import { ApiError } from "@/shared/errors";
import type {
  ProfileRepository,
  ProfileUpdateData,
  ProfileUserRow,
} from "../repositories/profile.repository.interface";

const log = logger.child("profile");

const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

/** Uploaded parts extracted by the controller from req.files (pure reads). */
export interface ProfileEditFiles {
  avatar: File | null;
  profile: File | null;
  backgroundImage: File | null;
  background_image: File | null;
}

/** KYC uploads extracted by the controller from req.files. */
export interface VerificationFiles {
  selfie: File | null;
  document: File | null;
}

function safeUser(u: ProfileUserRow) {
  const { id, email, name, role, status, isActive, phone, city, pan, about, avatar, createdAt, updatedAt } = u;
  return { id, email, name, role, status, isActive, phone, city, pan, about, avatar, createdAt, updatedAt };
}

/** Full self profile — the web fields plus the community (mobile) fields. */
function fullSelfUser(u: ProfileUserRow) {
  return { ...safeUser(u), ...communityUser(u, { self: true }) };
}

/** CSV string, JSON array or comma list → normalized CSV column value. */
function csvValue(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(",");
  const s = String(v).trim();
  return s === "" ? "" : s;
}

export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  /**
   * Store an uploaded part and return its absolute public URL. The origin
   * prefix is computed by the controller (host/proto are HTTP concerns); the
   * upload itself happens here, at the exact legacy point in each flow. The
   * legacy saveFieldFile re-ran requireAuth(req) before saving — that gate is
   * subsumed by the authenticate middleware, which ran the identical
   * revocation-aware check as the request's first step.
   */
  private async saveFile(file: File | null, folder: string, session: Session, origin: string): Promise<string | null> {
    if (!file) return null;
    const asset = await saveUpload(file, { folder, uploadedBy: { id: session.userId, name: session.name } });
    return `${origin}/api/files/${asset.id}/file`;
  }

  /** GET /api/profile — the signed-in user's full record + role-aware extras
   *  (donor CRM stats / volunteer profile / beneficiary case). */
  async getSelf(session: Session): Promise<{ user: Record<string, unknown>; extras: Record<string, unknown> }> {
    const user = await this.profileRepository.findUserById(session.userId);
    if (!user) throw new ApiError("Account not found", 404);

    const extras: Record<string, unknown> = {};

    if (session.role === "DONOR") {
      const [donor, agg, completed, campaignIds] = await Promise.all([
        this.profileRepository.findDonorProfile(session.userId, session.email),
        this.profileRepository.aggregateDonations(session.userId, session.email),
        this.profileRepository.aggregateCompletedDonations(session.userId, session.email),
        this.profileRepository.listSupportedCampaignIds(session.userId, session.email),
      ]);
      extras.donor = donor;
      extras.stats = {
        lifetimeValue: completed.sumAmount ?? 0,
        donationCount: agg.count,
        completedCount: completed.count,
        receiptsCount: completed.count, // every completed gift carries an 80G receipt number
        campaignsSupported: campaignIds.length,
        firstDonationAt: agg.firstAt,
        lastDonationAt: agg.lastAt,
      };
    }

    if (session.role === "VOLUNTEER") {
      const volunteer = await this.profileRepository.findVolunteerProfile(session.userId);
      if (volunteer) {
        const [tasksAssigned, tasksCompleted, attendanceDays, hours] = await Promise.all([
          this.profileRepository.countVolunteerTasksNotCancelled(volunteer.id),
          this.profileRepository.countVolunteerTasksCompleted(volunteer.id),
          this.profileRepository.countVolunteerAttendance(volunteer.id),
          this.profileRepository.sumVolunteerAttendanceHours(volunteer.id),
        ]);
        extras.volunteer = volunteer;
        extras.stats = {
          tasksAssigned,
          tasksCompleted,
          attendanceDays,
          hoursLogged: hours ?? 0,
        };
      } else {
        extras.volunteer = null;
        extras.stats = {
          tasksAssigned: 0,
          tasksCompleted: 0,
          attendanceDays: 0,
          hoursLogged: 0,
        };
      }
    }

    if (session.role === "BENEFICIARY") {
      const beneficiary = await this.profileRepository.findBeneficiaryProfile(session.userId);
      const requests = await this.profileRepository.listRecentBeneficiaryRequests(
        session.userId,
        beneficiary?.id ?? null,
        10
      );
      const requestsByStatus: Record<string, number> = {};
      for (const r of requests) {
        requestsByStatus[r.status] = (requestsByStatus[r.status] ?? 0) + 1;
      }
      extras.beneficiary = beneficiary;
      extras.stats = {
        totalRequests: requests.length,
        requestsByStatus,
        caseStatus: beneficiary?.caseStatus ?? null,
      };
      extras.recentRequests = requests;
    }

    if (session.role === "ADMIN") {
      const actionsCount = await this.profileRepository.countActivityByUser(session.userId);
      extras.stats = { actionsCount };
    }

    return { user: safeUser(user), extras };
  }

  /**
   * PATCH /api/profile — self-service edits (name/phone/city/about/avatar and
   * the community-profile fields: username, backgroundImage, interestIds,
   * pushNotifications, roomInvites, block/saved lists). Field checks, the
   * username-conflict lookup, the file uploads and the "Nothing to update"
   * guard keep their exact legacy order.
   */
  async update(
    session: Session,
    body: Record<string, unknown> | undefined,
    files: ProfileEditFiles,
    origin: string
  ): Promise<{ user: Record<string, unknown> }> {
    const data: ProfileUpdateData = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("Name cannot be empty", 400);
      data.name = name;
    }
    if (body?.phone !== undefined) {
      const phone = body.phone ? String(body.phone).trim() : null;
      if (phone && !PHONE_RE.test(phone.replace(/[\s-]/g, "")))
        throw new ApiError("Enter a valid 10-digit Indian mobile number", 400);
      data.phone = phone;
    }
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.about !== undefined) data.about = body.about ? String(body.about) : null;

    // Username — unique (legacy editProfile rule).
    if (body?.username !== undefined) {
      const username = String(body.username).trim();
      if (username && username !== "null" && username !== "") {
        const taken = await this.profileRepository.findUsernameOwner(username, session.userId);
        if (taken) {
          log.warn("profile_username_conflict", { userId: session.userId, username });
          throw new ApiError("Username is not available", 409);
        }
        data.username = username;
      }
    }
    if (body?.interestIds !== undefined) data.interestIds = csvValue(body.interestIds);
    if (body?.blockUserIds !== undefined) data.blockUserIds = csvValue(body.blockUserIds);
    if (body?.savedMusicIds !== undefined) data.savedMusicIds = csvValue(body.savedMusicIds);
    if (body?.savedReelIds !== undefined) data.savedReelIds = csvValue(body.savedReelIds);
    if (body?.savedPostIds !== undefined) data.savedPostIds = csvValue(body.savedPostIds);
    // Toggle flags — accept booleans or the legacy 0/1 ints.
    if (body?.pushNotifications !== undefined)
      data.isPushNotifications =
        body.pushNotifications === true || body.pushNotifications === 1 || body.pushNotifications === "1" ? 1 : 0;
    if (body?.roomInvites !== undefined)
      data.isInvitedToRoom =
        body.roomInvites === true || body.roomInvites === 1 || body.roomInvites === "1" ? 1 : 0;

    // Uploaded images win over URL fields (multipart fields: avatar/profile,
    // backgroundImage/background_image).
    const avatarUrl =
      (await this.saveFile(files.avatar, "profiles", session, origin)) ??
      (await this.saveFile(files.profile, "profiles", session, origin));
    if (avatarUrl) data.avatar = avatarUrl;
    else if (body?.avatar !== undefined) data.avatar = body.avatar ? String(body.avatar) : null;
    const bgUrl =
      (await this.saveFile(files.backgroundImage, "profiles", session, origin)) ??
      (await this.saveFile(files.background_image, "profiles", session, origin));
    if (bgUrl) data.backgroundImage = bgUrl;
    else if (body?.backgroundImage !== undefined)
      data.backgroundImage = body.backgroundImage ? String(body.backgroundImage) : null;

    if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);

    const updated = await this.profileRepository.updateProfile(session.userId, data);
    log.info("profile_updated", {
      userId: session.userId,
      fields: Object.keys(data),
      actor: session.userId,
    });

    await logActivity(
      updated.name,
      "PROFILE_UPDATE",
      "USER",
      `${updated.email} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    return { user: fullSelfUser(updated) };
  }

  /**
   * POST /api/profile/verification — KYC submission (legacy profileVerification):
   * multipart selfie + document, stamps the account isVerified=1 (pending
   * review). State gates run before the required-field checks, which run
   * before either file is persisted — exact legacy order.
   */
  async submitVerification(
    session: Session,
    body: Record<string, unknown> | undefined,
    files: VerificationFiles,
    origin: string
  ): Promise<{ ok: boolean; verification: Record<string, unknown> }> {
    const user = await this.profileRepository.findUserById(session.userId);
    if (!user) throw new ApiError("User not found", 404);
    if (user.isVerified === 1) {
      log.warn("profile_verification_already_pending", { userId: session.userId });
      throw new ApiError("Profile verification in pending", 400);
    }
    if (user.isVerified !== 0) {
      log.warn("profile_verification_already_verified", { userId: session.userId });
      throw new ApiError("Profile is already verified", 400);
    }

    const fullName = String(body?.fullName ?? body?.full_name ?? "").trim();
    if (!fullName) throw new ApiError("The full name field is required", 400);
    const documentType = String(body?.documentType ?? body?.document_type ?? "").trim();
    if (!documentType) throw new ApiError("The document type field is required", 400);

    const selfieUrl = await this.saveFile(files.selfie, "verification", session, origin);
    if (!selfieUrl) throw new ApiError("The selfie field is required", 400);
    const documentUrl = await this.saveFile(files.document, "verification", session, origin);
    if (!documentUrl) throw new ApiError("The document field is required", 400);

    const row = await this.profileRepository.createVerification({
      userId: session.userId,
      selfie: selfieUrl,
      document: documentUrl,
      documentType,
      fullName,
    });
    await this.profileRepository.markVerificationPending(session.userId);
    log.info("profile_verification_submitted", {
      userId: session.userId,
      verificationId: row.id,
      documentType,
      actor: session.userId,
    });

    return {
      ok: true,
      verification: {
        id: row.id,
        userId: row.userId,
        selfie: row.selfie,
        document: row.document,
        documentType: row.documentType,
        fullName: row.fullName,
        createdAt: row.createdAt,
      },
    };
  }

  /**
   * POST /api/profile/user-type — one-time supporter|volunteer choice (legacy
   * user/select-type). Volunteers enter the pending approval pipeline.
   */
  async selectUserType(
    session: Session,
    body: Record<string, unknown> | undefined
  ): Promise<{ ok: boolean; user: Record<string, unknown> }> {
    const userType = String(body?.userType ?? body?.user_type ?? "").trim();
    if (userType !== "supporter" && userType !== "volunteer")
      throw new ApiError("The selected user type is invalid", 400);

    const user = await this.profileRepository.findUserById(session.userId);
    if (!user) throw new ApiError("User not found", 404);
    if (user.userType !== null && user.userType !== undefined) {
      log.warn("profile_user_type_already_set", {
        userId: session.userId,
        userType: user.userType,
      });
      throw new ApiError("User type has already been selected", 400);
    }

    const updated = await this.profileRepository.setUserType(session.userId, {
      userType,
      ...(userType === "volunteer"
        ? { volunteerStatus: "pending", volunteerRequestedAt: new Date() }
        : {}),
    });
    log.info("profile_user_type_selected", {
      userId: session.userId,
      userType,
      actor: session.userId,
    });

    return { ok: true, user: fullSelfUser(updated) };
  }

  /**
   * POST /api/profile/device-token — register the push credentials of the
   * signed-in user (legacy notifications/register-token): platform 'ios'
   * stores the token in apnsToken, anything else in fcmToken;
   * deviceToken/deviceType are kept in sync for backward compatibility.
   */
  async registerDeviceToken(
    session: Session,
    body: Record<string, unknown> | undefined
  ): Promise<{ ok: boolean }> {
    const token = String(body?.token ?? body?.deviceToken ?? body?.device_token ?? "").trim();
    if (!token) throw new ApiError("The device token field is required", 400);

    const platformRaw = String(body?.platform ?? "").toLowerCase();
    const deviceTypeRaw = Number(body?.deviceType ?? body?.device_type);
    const isIos = platformRaw === "ios" || deviceTypeRaw === 1;
    const deviceType = isIos ? 1 : 2; // legacy register-token semantics: 1 iOS · 2 Android

    await this.profileRepository.setDeviceToken(session.userId, {
      ...(isIos ? { apnsToken: token } : { fcmToken: token }),
      deviceType,
      deviceToken: token, // backward compatibility
    });
    log.info("device_token_registered", {
      userId: session.userId,
      deviceType,
      actor: session.userId,
    });
    return { ok: true };
  }

  /** DELETE /api/profile/device-token — clear the push credentials on logout
   *  (legacy /logOut cleared the device token). */
  async clearDeviceToken(session: Session): Promise<{ ok: boolean }> {
    await this.profileRepository.clearDeviceTokens(session.userId);
    log.info("device_token_cleared", { userId: session.userId, actor: session.userId });
    return { ok: true };
  }

  /**
   * GET /api/profile/analytics — role-aware aggregate object for the universal
   * "My analytics" page. ADMIN → activity trail, DONOR → gift aggregates with
   * a zero-filled last-6-month trend, VOLUNTEER → task/attendance aggregates,
   * BENEFICIARY (and any other signed-in role) → help-request analytics.
   */
  async getAnalytics(session: Session): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { role: session.role, generatedAt: new Date().toISOString() };

    /* ------------------------------- ADMIN ------------------------------- */
    if (session.role === "ADMIN") {
      const [actionsCount, breakdown, recent] = await Promise.all([
        this.profileRepository.countActivityByUser(session.userId),
        this.profileRepository.groupActivityByEntity(session.userId),
        this.profileRepository.listRecentActivity(session.userId, 12),
      ]);
      out.actionsCount = actionsCount;
      out.entityBreakdown = breakdown
        .map((b) => ({ entityType: b.entityType, count: b.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
      out.recentActions = recent.map((r) => ({
        action: r.action,
        entityType: r.entityType,
        details: r.details,
        createdAt: r.createdAt,
      }));
      return out;
    }

    /* -------------------------------- DONOR ------------------------------ */
    if (session.role === "DONOR") {
      const since = new Date();
      since.setMonth(since.getMonth() - 5);
      since.setDate(1);
      since.setHours(0, 0, 0, 0);

      const [all, completedAgg, completedDonations, campaignIds, recent] = await Promise.all([
        this.profileRepository.aggregateDonations(session.userId, session.email),
        this.profileRepository.aggregateCompletedDonations(session.userId, session.email),
        this.profileRepository.listCompletedDonationsSince(session.userId, session.email, since),
        this.profileRepository.listSupportedCampaignIds(session.userId, session.email),
        this.profileRepository.listRecentDonations(session.userId, session.email, 8),
      ]);

      const categories = await this.profileRepository.groupCompletedDonationsByCategory(
        session.userId,
        session.email
      );

      // Last-6-month trend (including the current month), zero-filled.
      const monthly: Array<{ month: string; amount: number }> = [];
      const buckets = new Map<string, number>();
      for (const d of completedDonations) {
        const dt = new Date(d.createdAt);
        const key = `${dt.getFullYear()}-${dt.getMonth()}`;
        buckets.set(key, (buckets.get(key) ?? 0) + (Number(d.amount) || 0));
      }
      for (let i = 5; i >= 0; i--) {
        const dt = new Date();
        dt.setDate(1);
        dt.setMonth(dt.getMonth() - i);
        monthly.push({
          month: dt.toLocaleString("en-IN", { month: "short" }),
          amount: buckets.get(`${dt.getFullYear()}-${dt.getMonth()}`) ?? 0,
        });
      }

      out.totalDonated = completedAgg.sumAmount ?? 0;
      out.donationCount = all.count;
      out.receiptsCount = completedAgg.count;
      out.campaignsSupported = campaignIds.length;
      out.firstDonationAt = completedAgg.firstAt;
      out.lastDonationAt = completedAgg.lastAt;
      out.monthlyTrend = monthly;
      out.categoriesSplit = categories
        .map((c) => ({ category: c.category, amount: c.amount ?? 0, count: c.count }))
        .sort((a, b) => b.amount - a.amount);
      out.recentDonations = recent.map((d) => ({
        ...d,
        campaignTitle: d.campaign?.title ?? null,
        campaign: undefined,
      }));
      return out;
    }

    /* ------------------------------ VOLUNTEER ---------------------------- */
    if (session.role === "VOLUNTEER") {
      const volunteer = await this.profileRepository.findVolunteerProfile(session.userId);
      if (!volunteer) {
        Object.assign(out, {
          tasksAssigned: 0,
          tasksCompleted: 0,
          completionRate: 0,
          hoursLogged: 0,
          attendanceDays: 0,
          upcomingTasks: [],
          tasksByType: [],
          recentTasks: [],
        });
        return out;
      }

      const now = new Date();
      const [tasksAssigned, tasksCompleted, attendanceDays, hours, byType, upcoming, recent] =
        await Promise.all([
          this.profileRepository.countVolunteerTasksNotCancelled(volunteer.id),
          this.profileRepository.countVolunteerTasksCompleted(volunteer.id),
          this.profileRepository.countVolunteerAttendance(volunteer.id),
          this.profileRepository.sumVolunteerAttendanceHours(volunteer.id),
          this.profileRepository.groupVolunteerTasksByType(volunteer.id),
          this.profileRepository.listUpcomingVolunteerTasks(volunteer.id, now, 5),
          this.profileRepository.listRecentVolunteerTasks(volunteer.id, 6),
        ]);

      out.tasksAssigned = tasksAssigned;
      out.tasksCompleted = tasksCompleted;
      out.completionRate =
        tasksAssigned > 0 ? Math.round((tasksCompleted / tasksAssigned) * 100) : 0;
      out.hoursLogged = hours ?? 0;
      out.attendanceDays = attendanceDays;
      out.upcomingTasks = upcoming.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        priority: t.priority,
        location: t.location,
        scheduledDate: t.scheduledDate,
      }));
      out.tasksByType = byType
        .map((t) => ({ type: t.type, count: t.count }))
        .sort((a, b) => b.count - a.count);
      out.recentTasks = recent.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        status: t.status,
        scheduledDate: t.scheduledDate,
      }));
      return out;
    }

    /* ----------------------------- BENEFICIARY --------------------------- */
    // BENEFICIARY (and any other signed-in role) — help-request analytics.
    const beneficiary = await this.profileRepository.findBeneficiaryProfile(session.userId);
    const beneficiaryId = beneficiary?.id ?? null;

    const [totalRequests, byStatus, recent] = await Promise.all([
      this.profileRepository.countBeneficiaryRequests(session.userId, beneficiaryId),
      this.profileRepository.groupBeneficiaryRequestsByStatus(session.userId, beneficiaryId),
      this.profileRepository.listRecentBeneficiaryRequests(session.userId, beneficiaryId, 8),
    ]);

    out.totalRequests = totalRequests;
    out.requestsByStatus = byStatus
      .map((s) => ({ status: s.status, count: s.count }))
      .sort((a, b) => b.count - a.count);
    out.caseStatus = beneficiary?.caseStatus ?? null;
    out.recentRequests = recent.map((r) => ({
      id: r.id,
      category: r.category,
      urgency: r.urgency,
      status: r.status,
      details: r.details,
      createdAt: r.createdAt,
    }));

    return out;
  }

  /**
   * POST /api/profile/password — self-service password change: verifies the
   * current password, enforces min length + difference, hashes the new value.
   * (No tokenValidAfter bump in the legacy flow — sessions stay valid.)
   */
  async changePassword(
    session: Session,
    body: Record<string, unknown> | undefined
  ): Promise<{ ok: boolean }> {
    const current = String(body?.current ?? "");
    const next = String(body?.next ?? "");

    const user = await this.profileRepository.findUserById(session.userId);
    if (!user) throw new ApiError("Account not found", 404);

    if (!current || !verifyPassword(current, user.password))
      throw new ApiError("Current password is incorrect", 400);
    if (!next || next.length < 6)
      throw new ApiError("New password must be at least 6 characters", 400);
    if (next === current)
      throw new ApiError("New password must be different from the current one", 400);

    await this.profileRepository.setUserPassword(session.userId, hashPassword(next));

    log.info("password_changed", {
      userId: session.userId,
      email: session.email,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "PASSWORD_CHANGE",
      "USER",
      `${session.email} changed their password`,
      session.userId
    );

    return { ok: true };
  }
}
