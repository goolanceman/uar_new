/**
 * Community admin repository implementation — delegates every operation to
 * the shared domain module @/domains/community/admin, which owns ALL moderation
 * Prisma access, push fan-out and cache invalidation. The wire shapes are
 * therefore produced by exactly the legacy code path.
 */
import {
  addDocumentType as addDocumentTypeFn,
  addReportReason as addReportReasonFn,
  addUsernameRestrictions as addUsernameRestrictionsFn,
  adminCauses as adminCausesFn,
  adminDonations as adminDonationsFn,
  adminPosts as adminPostsFn,
  adminReels as adminReelsFn,
  adminReports as adminReportsFn,
  adminUsers as adminUsersFn,
  deleteAdminNotification as deleteAdminNotificationFn,
  deleteDocumentType as deleteDocumentTypeFn,
  deleteReportReason as deleteReportReasonFn,
  deleteUsernameRestriction as deleteUsernameRestrictionFn,
  listAdminNotifications as listAdminNotificationsFn,
  listDocumentTypes as listDocumentTypesFn,
  listReportReasons as listReportReasonsFn,
  listUsernameRestrictions as listUsernameRestrictionsFn,
  listVerifications as listVerificationsFn,
  listVerifiedMembers as listVerifiedMembersFn,
  moderatePost as moderatePostFn,
  repeatAdminNotification as repeatAdminNotificationFn,
  resolveReport as resolveReportFn,
  resolveVerification as resolveVerificationFn,
  sendAdminNotification as sendAdminNotificationFn,
  updateAdminNotification as updateAdminNotificationFn,
  updateDocumentType as updateDocumentTypeFn,
  updateReportReason as updateReportReasonFn,
  updateUsernameRestriction as updateUsernameRestrictionFn,
} from "@/domains/community/admin";
import type { Session } from "@/infrastructure/auth/session";
import type {
  CommunityAdminRepository,
  ListVerificationsOptions,
} from "./community-admin.repository.interface";

export class PrismaCommunityAdminRepository implements CommunityAdminRepository {
  adminUsers(q: string, tier: string | null, skip: number, limit: number) {
    return adminUsersFn(q, tier, skip, limit);
  }

  adminPosts(q: string, type: string | null, skip: number, limit: number) {
    return adminPostsFn(q, type, skip, limit);
  }

  adminReels(q: string, status: string | null, skip: number, limit: number) {
    return adminReelsFn(q, status, skip, limit);
  }

  moderatePost(session: Session, postId: string, action: string) {
    return moderatePostFn(session, postId, action);
  }

  adminReports(type: number | null, skip: number, limit: number) {
    return adminReportsFn(type, skip, limit);
  }

  resolveReport(session: Session, reportId: string, action: string) {
    return resolveReportFn(session, reportId, action);
  }

  adminCauses(q: string, skip: number, limit: number) {
    return adminCausesFn(q, skip, limit);
  }

  adminDonations(causePostId: string | null, skip: number, limit: number) {
    return adminDonationsFn(causePostId, skip, limit);
  }

  listDocumentTypes() {
    return listDocumentTypesFn();
  }

  addDocumentType(title: string) {
    return addDocumentTypeFn(title);
  }

  updateDocumentType(id: number, title: string) {
    return updateDocumentTypeFn(id, title);
  }

  deleteDocumentType(id: number) {
    return deleteDocumentTypeFn(id);
  }

  listReportReasons(skip: number, take: number) {
    return listReportReasonsFn(skip, take);
  }

  addReportReason(title: string) {
    return addReportReasonFn(title);
  }

  updateReportReason(id: number, title: string) {
    return updateReportReasonFn(id, title);
  }

  deleteReportReason(id: number) {
    return deleteReportReasonFn(id);
  }

  listUsernameRestrictions(skip: number, take: number) {
    return listUsernameRestrictionsFn(skip, take);
  }

  addUsernameRestrictions(title: string) {
    return addUsernameRestrictionsFn(title);
  }

  updateUsernameRestriction(id: number, title: string) {
    return updateUsernameRestrictionFn(id, title);
  }

  deleteUsernameRestriction(id: number) {
    return deleteUsernameRestrictionFn(id);
  }

  listVerifications(opts: ListVerificationsOptions) {
    return listVerificationsFn(opts);
  }

  listVerifiedMembers(opts: { q?: string; skip: number; take: number }) {
    return listVerifiedMembersFn(opts);
  }

  resolveVerification(session: Session, userId: string, approve: boolean) {
    return resolveVerificationFn(session, userId, approve);
  }

  listAdminNotifications(opts: { q?: string; skip: number; take: number }) {
    return listAdminNotificationsFn(opts);
  }

  sendAdminNotification(session: Session, title: string, description: string) {
    return sendAdminNotificationFn(session, title, description);
  }

  updateAdminNotification(id: number, title: string, description: string) {
    return updateAdminNotificationFn(id, title, description);
  }

  repeatAdminNotification(session: Session, id: number, title?: string, description?: string) {
    return repeatAdminNotificationFn(session, id, title, description);
  }

  deleteAdminNotification(id: number) {
    return deleteAdminNotificationFn(id);
  }
}
