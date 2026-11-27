/**
 * Prisma implementation of the profile repository — the ONLY place in the
 * profile module that touches Prisma models directly. Every legacy query
 * shape (scopes, distinct/groupBy projections, ordering, take limits) is
 * reproduced exactly; the service composes them in the legacy order
 * (including its Promise.all parallelism).
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  ActivityRow,
  BeneficiaryProfileRow,
  BeneficiaryRequestRow,
  CategorySlice,
  DeviceTokenData,
  DonationAggregate,
  DonorProfileRow,
  EntitySlice,
  ProfileRepository,
  ProfileUpdateData,
  ProfileUserRow,
  RecentDonationRow,
  StatusSlice,
  TypeSlice,
  VerificationCreateData,
  VerificationRow,
  VolunteerProfileRow,
  VolunteerTaskRow,
  UserTypeData,
} from "./profile.repository.interface";

/** Donation scope of a signed-in user: their CRM donorId OR donor email. */
function donationScope(userId: string, email: string) {
  return { OR: [{ donorId: userId }, { donorEmail: email }] };
}

/** Help-request scope: the beneficiary's CRM case id when one exists. */
function requestScope(userId: string, beneficiaryId: string | null) {
  return beneficiaryId ? { OR: [{ userId }, { beneficiaryId }] } : { userId };
}

export class PrismaProfileRepository implements ProfileRepository {
  // ── User record + profile edits ──

  async findUserById(id: string): Promise<ProfileUserRow | null> {
    return db.user.findUnique({ where: { id } });
  }

  async findUsernameOwner(username: string, excludingUserId: string): Promise<{ id: string } | null> {
    return db.user.findFirst({
      where: { username, id: { not: excludingUserId } },
      select: { id: true },
    });
  }

  /** username is unique — a race past the service's conflict check maps to the
   *  shared 409 instead of a raw Prisma 500. */
  async updateProfile(id: string, data: ProfileUpdateData): Promise<ProfileUserRow> {
    return mapPrismaError(() => db.user.update({ where: { id }, data }));
  }

  async setUserType(id: string, data: UserTypeData): Promise<ProfileUserRow> {
    return db.user.update({
      where: { id },
      data: {
        userType: data.userType,
        ...(data.volunteerStatus !== undefined ? { volunteerStatus: data.volunteerStatus } : {}),
        ...(data.volunteerRequestedAt !== undefined
          ? { volunteerRequestedAt: data.volunteerRequestedAt }
          : {}),
      },
    });
  }

  async setUserPassword(id: string, passwordHash: string): Promise<void> {
    await db.user.update({ where: { id }, data: { password: passwordHash } });
  }

  async setDeviceToken(id: string, data: DeviceTokenData): Promise<void> {
    await db.user.update({
      where: { id },
      data: {
        ...(data.apnsToken !== undefined ? { apnsToken: data.apnsToken } : {}),
        ...(data.fcmToken !== undefined ? { fcmToken: data.fcmToken } : {}),
        deviceType: data.deviceType,
        deviceToken: data.deviceToken,
      },
    });
  }

  async clearDeviceTokens(id: string): Promise<void> {
    await db.user.update({
      where: { id },
      data: { fcmToken: null, apnsToken: null, deviceToken: null },
    });
  }

  // ── KYC verification ──

  /** userId is a foreign key — a race past the service's user lookup maps to
   *  the shared conflict error instead of a raw Prisma 500. */
  async createVerification(data: VerificationCreateData): Promise<VerificationRow> {
    return mapPrismaError(() => db.profileVerification.create({ data }));
  }

  async markVerificationPending(id: string): Promise<void> {
    await db.user.update({ where: { id }, data: { isVerified: 1 } }); // pending review
  }

  // ── Donor CRM ──

  async findDonorProfile(userId: string, email: string): Promise<DonorProfileRow | null> {
    return db.donor.findFirst({
      where: { OR: [{ userId }, { email }] },
    });
  }

  async aggregateDonations(userId: string, email: string): Promise<DonationAggregate> {
    const agg = await db.donation.aggregate({
      where: donationScope(userId, email),
      _sum: { amount: true },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    return {
      sumAmount: agg._sum.amount,
      count: agg._count._all,
      firstAt: agg._min.createdAt,
      lastAt: agg._max.createdAt,
    };
  }

  async aggregateCompletedDonations(userId: string, email: string): Promise<DonationAggregate> {
    const agg = await db.donation.aggregate({
      where: { ...donationScope(userId, email), paymentStatus: "COMPLETED" },
      _sum: { amount: true },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    return {
      sumAmount: agg._sum.amount,
      count: agg._count._all,
      firstAt: agg._min.createdAt,
      lastAt: agg._max.createdAt,
    };
  }

  async listSupportedCampaignIds(userId: string, email: string): Promise<Array<{ campaignId: string | null }>> {
    return db.donation.findMany({
      where: { ...donationScope(userId, email), campaignId: { not: null } },
      select: { campaignId: true },
      distinct: ["campaignId"],
    });
  }

  async listCompletedDonationsSince(
    userId: string,
    email: string,
    since: Date
  ): Promise<Array<{ createdAt: Date; amount: number }>> {
    return db.donation.findMany({
      where: {
        ...donationScope(userId, email),
        paymentStatus: "COMPLETED",
        createdAt: { gte: since },
      },
      select: { createdAt: true, amount: true },
    });
  }

  async listRecentDonations(userId: string, email: string, take: number): Promise<RecentDonationRow[]> {
    return db.donation.findMany({
      where: donationScope(userId, email),
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        receiptNumber: true,
        amount: true,
        category: true,
        type: true,
        paymentStatus: true,
        createdAt: true,
        campaign: { select: { title: true } },
      },
    });
  }

  async groupCompletedDonationsByCategory(userId: string, email: string): Promise<CategorySlice[]> {
    const rows = await db.donation.groupBy({
      by: ["category"],
      where: { ...donationScope(userId, email), paymentStatus: "COMPLETED" },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return rows.map((c) => ({ category: c.category, amount: c._sum.amount, count: c._count._all }));
  }

  // ── Volunteer CRM ──

  async findVolunteerProfile(userId: string): Promise<VolunteerProfileRow | null> {
    return db.volunteer.findUnique({ where: { userId } });
  }

  async countVolunteerTasksNotCancelled(volunteerId: string): Promise<number> {
    return db.volunteerTask.count({
      where: { volunteerId, status: { not: "CANCELLED" } },
    });
  }

  async countVolunteerTasksCompleted(volunteerId: string): Promise<number> {
    return db.volunteerTask.count({
      where: { volunteerId, status: "COMPLETED" },
    });
  }

  async countVolunteerAttendance(volunteerId: string): Promise<number> {
    return db.volunteerAttendance.count({ where: { volunteerId } });
  }

  async sumVolunteerAttendanceHours(volunteerId: string): Promise<number | null> {
    const agg = await db.volunteerAttendance.aggregate({
      where: { volunteerId },
      _sum: { hours: true },
    });
    return agg._sum.hours;
  }

  async groupVolunteerTasksByType(volunteerId: string): Promise<TypeSlice[]> {
    const rows = await db.volunteerTask.groupBy({
      by: ["type"],
      where: { volunteerId },
      _count: { _all: true },
    });
    return rows.map((t) => ({ type: t.type, count: t._count._all }));
  }

  async listUpcomingVolunteerTasks(volunteerId: string, now: Date, take: number): Promise<VolunteerTaskRow[]> {
    return db.volunteerTask.findMany({
      where: {
        volunteerId,
        scheduledDate: { gte: now },
        status: { in: ["ASSIGNED", "IN_PROGRESS"] },
      },
      orderBy: { scheduledDate: "asc" },
      take,
    });
  }

  async listRecentVolunteerTasks(volunteerId: string, take: number): Promise<VolunteerTaskRow[]> {
    return db.volunteerTask.findMany({
      where: { volunteerId },
      orderBy: { scheduledDate: "desc" },
      take,
    });
  }

  // ── Beneficiary CRM ──

  async findBeneficiaryProfile(userId: string): Promise<BeneficiaryProfileRow | null> {
    return db.beneficiary.findUnique({ where: { userId } });
  }

  async countBeneficiaryRequests(userId: string, beneficiaryId: string | null): Promise<number> {
    return db.beneficiaryRequest.count({ where: requestScope(userId, beneficiaryId) });
  }

  async groupBeneficiaryRequestsByStatus(
    userId: string,
    beneficiaryId: string | null
  ): Promise<StatusSlice[]> {
    const rows = await db.beneficiaryRequest.groupBy({
      by: ["status"],
      where: requestScope(userId, beneficiaryId),
      _count: { _all: true },
    });
    return rows.map((s) => ({ status: s.status, count: s._count._all }));
  }

  async listRecentBeneficiaryRequests(
    userId: string,
    beneficiaryId: string | null,
    take: number
  ): Promise<BeneficiaryRequestRow[]> {
    return db.beneficiaryRequest.findMany({
      where: requestScope(userId, beneficiaryId),
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  // ── Audit trail (ADMIN) ──

  async countActivityByUser(userId: string): Promise<number> {
    return db.activityLog.count({ where: { userId } });
  }

  async groupActivityByEntity(userId: string): Promise<EntitySlice[]> {
    const rows = await db.activityLog.groupBy({
      by: ["entityType"],
      where: { userId },
      _count: { _all: true },
    });
    return rows.map((b) => ({ entityType: b.entityType, count: b._count._all }));
  }

  async listRecentActivity(userId: string, take: number): Promise<ActivityRow[]> {
    return db.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
    });
  }
}
