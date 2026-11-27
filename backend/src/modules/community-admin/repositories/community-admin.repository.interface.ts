/**
 * Community admin repository contract — persistence gateway for the
 * /api/community/admin surface. ALL Prisma access for community moderation
 * lives in the shared domain module @/lib/community/admin (read-only shared
 * code); this contract exposes exactly the operations the endpoints use so
 * the service stays decoupled from HTTP and Prisma alike.
 */
import type {
  addDocumentType,
  addReportReason,
  addUsernameRestrictions,
  adminCauses,
  adminDonations,
  adminPosts,
  adminReels,
  adminReports,
  adminUsers,
  deleteAdminNotification,
  deleteDocumentType,
  deleteReportReason,
  deleteUsernameRestriction,
  listAdminNotifications,
  listDocumentTypes,
  listReportReasons,
  listUsernameRestrictions,
  listVerifications,
  listVerifiedMembers,
  moderatePost,
  repeatAdminNotification,
  resolveReport,
  resolveVerification,
  sendAdminNotification,
  updateAdminNotification,
  updateDocumentType,
  updateReportReason,
  updateUsernameRestriction,
} from "@/lib/community/admin";
import type { Session } from "@/lib/session";

export type AdminUsersResult = Awaited<ReturnType<typeof adminUsers>>;
export type AdminPostsResult = Awaited<ReturnType<typeof adminPosts>>;
export type AdminReelsResult = Awaited<ReturnType<typeof adminReels>>;
export type AdminReportsResult = Awaited<ReturnType<typeof adminReports>>;
export type AdminCausesResult = Awaited<ReturnType<typeof adminCauses>>;
export type AdminDonationsResult = Awaited<ReturnType<typeof adminDonations>>;

export interface ListVerificationsOptions {
  q?: string;
  status?: string;
  skip: number;
  take: number;
}
export type ListVerificationsResult = Awaited<ReturnType<typeof listVerifications>>;
export type ListVerifiedMembersResult = Awaited<ReturnType<typeof listVerifiedMembers>>;
export type ListAdminNotificationsResult = Awaited<ReturnType<typeof listAdminNotifications>>;

export interface CommunityAdminRepository {
  adminUsers(q: string, tier: string | null, skip: number, limit: number): Promise<AdminUsersResult>;
  adminPosts(q: string, type: string | null, skip: number, limit: number): Promise<AdminPostsResult>;
  adminReels(q: string, status: string | null, skip: number, limit: number): Promise<AdminReelsResult>;
  moderatePost(session: Session, postId: string, action: string): Promise<Awaited<ReturnType<typeof moderatePost>>>;
  adminReports(type: number | null, skip: number, limit: number): Promise<AdminReportsResult>;
  resolveReport(
    session: Session,
    reportId: string,
    action: string
  ): Promise<Awaited<ReturnType<typeof resolveReport>>>;
  adminCauses(q: string, skip: number, limit: number): Promise<AdminCausesResult>;
  adminDonations(
    causePostId: string | null,
    skip: number,
    limit: number
  ): Promise<AdminDonationsResult>;

  listDocumentTypes(): Promise<Awaited<ReturnType<typeof listDocumentTypes>>>;
  addDocumentType(title: string): Promise<Awaited<ReturnType<typeof addDocumentType>>>;
  updateDocumentType(id: number, title: string): Promise<Awaited<ReturnType<typeof updateDocumentType>>>;
  deleteDocumentType(id: number): Promise<Awaited<ReturnType<typeof deleteDocumentType>>>;

  listReportReasons(skip: number, take: number): Promise<Awaited<ReturnType<typeof listReportReasons>>>;
  addReportReason(title: string): Promise<Awaited<ReturnType<typeof addReportReason>>>;
  updateReportReason(id: number, title: string): Promise<Awaited<ReturnType<typeof updateReportReason>>>;
  deleteReportReason(id: number): Promise<Awaited<ReturnType<typeof deleteReportReason>>>;

  listUsernameRestrictions(
    skip: number,
    take: number
  ): Promise<Awaited<ReturnType<typeof listUsernameRestrictions>>>;
  addUsernameRestrictions(
    title: string
  ): Promise<Awaited<ReturnType<typeof addUsernameRestrictions>>>;
  updateUsernameRestriction(
    id: number,
    title: string
  ): Promise<Awaited<ReturnType<typeof updateUsernameRestriction>>>;
  deleteUsernameRestriction(
    id: number
  ): Promise<Awaited<ReturnType<typeof deleteUsernameRestriction>>>;

  listVerifications(opts: ListVerificationsOptions): Promise<ListVerificationsResult>;
  listVerifiedMembers(opts: { q?: string; skip: number; take: number }): Promise<ListVerifiedMembersResult>;
  resolveVerification(
    session: Session,
    userId: string,
    approve: boolean
  ): Promise<Awaited<ReturnType<typeof resolveVerification>>>;

  listAdminNotifications(opts: { q?: string; skip: number; take: number }): Promise<ListAdminNotificationsResult>;
  sendAdminNotification(
    session: Session,
    title: string,
    description: string
  ): Promise<Awaited<ReturnType<typeof sendAdminNotification>>>;
  updateAdminNotification(
    id: number,
    title: string,
    description: string
  ): Promise<Awaited<ReturnType<typeof updateAdminNotification>>>;
  repeatAdminNotification(
    session: Session,
    id: number,
    title?: string,
    description?: string
  ): Promise<Awaited<ReturnType<typeof repeatAdminNotification>>>;
  deleteAdminNotification(
    id: number
  ): Promise<Awaited<ReturnType<typeof deleteAdminNotification>>>;
}
