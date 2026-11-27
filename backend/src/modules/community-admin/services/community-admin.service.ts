/**
 * Community admin service — moderation queues, config lists, profile
 * verifications and platform announcements. Depends on the repository
 * contract (which delegates to the shared @/lib/community/admin domain
 * module), throws application errors, never touches HTTP.
 *
 * The legacy handlers coerced/validated by hand mid-flow — the exact
 * expressions, check order (document-type PATCH: id before title;
 * report-reason PATCH: title before an unchecked Number(id) — NaN passes
 * through to Prisma exactly like before) and bare error messages are kept
 * here, and every log event keeps its legacy name.
 */
import { logger } from "@/lib/logger";
import { paged } from "@/lib/community/serializers";
import { ApiError } from "@/shared/errors";
import type { Session } from "@/lib/session";
import type { CommunityAdminRepository } from "../repositories/community-admin.repository.interface";

const log = logger.child("community:admin");

export class CommunityAdminService {
  constructor(private readonly communityAdminRepository: CommunityAdminRepository) {}

  // ─── Directory lists ────────────────────────────────────────────────────

  /** GET /users — members + charity profile + activity counts. */
  async listUsers(q: string, tier: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.communityAdminRepository.adminUsers(q, tier, skip, limit);
    return paged(items, page, limit, total);
  }

  /** GET /posts — moderation list with per-post report counts. */
  async listPosts(q: string, type: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.communityAdminRepository.adminPosts(q, type, skip, limit);
    return paged(items, page, limit, total);
  }

  /** GET /reels — every reel with its transcode state. */
  async listReels(q: string, status: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.communityAdminRepository.adminReels(q, status, skip, limit);
    return paged(items, page, limit, total);
  }

  /** POST /posts/moderate — verify/restrict/delete a post. */
  async moderate(session: Session, postId: string, action: string) {
    const result = await this.communityAdminRepository.moderatePost(session, postId, action);
    log.info("post_moderated", { postId, action, actor: session.userId });
    return result;
  }

  /** GET /reports — the moderation queue (?type= is numeric). */
  async listReports(typeRaw: unknown, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const type = typeRaw !== undefined && typeRaw !== "" ? Number(typeRaw) : null;
    const { items, total } = await this.communityAdminRepository.adminReports(
      type !== null && Number.isFinite(type) ? type : null,
      skip,
      limit
    );
    return paged(items, page, limit, total);
  }

  /** POST /reports/resolve — delete reported content / dismiss. */
  async resolveReport(session: Session, reportId: string, action: string) {
    const result = await this.communityAdminRepository.resolveReport(session, reportId, action);
    log.info("report_resolved", { reportId, action, actor: session.userId });
    return result;
  }

  /** GET /causes — CommunityPost(type=cause) fundraising list. */
  async listCauses(q: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total, totalRaisedAll } = await this.communityAdminRepository.adminCauses(q, skip, limit);
    return { ...paged(items, page, limit, total), totalRaisedAll };
  }

  /** GET /donations — cause donations with the cause wire. */
  async listDonations(causePostId: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total, totalRaised } = await this.communityAdminRepository.adminDonations(
      causePostId,
      skip,
      limit
    );
    return { ...paged(items, page, limit, total), totalRaised };
  }

  // ─── Config lists — document types / report reasons / username restrictions ─

  /** GET /document-types — titles served to the mobile app (KV-backed). */
  async listDocumentTypes() {
    return this.communityAdminRepository.listDocumentTypes();
  }

  /** POST /document-types */
  async addDocumentType(session: Session, title: string) {
    if (!title) throw new ApiError("The title field is required.", 400);
    const result = await this.communityAdminRepository.addDocumentType(title);
    log.info("document_type_created", { id: result.id, title, actor: session.userId });
    return result;
  }

  /** PATCH /document-types/:id — legacy checked the id BEFORE the title. */
  async updateDocumentType(session: Session, idRaw: string, title: string) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id < 0) throw new ApiError("Invalid document type id", 400);
    if (!title) throw new ApiError("The title field is required.", 400);
    const result = await this.communityAdminRepository.updateDocumentType(id, title);
    log.info("document_type_updated", { id, title, actor: session.userId });
    return result;
  }

  /** DELETE /document-types/:id */
  async deleteDocumentType(session: Session, idRaw: string) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id < 0) throw new ApiError("Invalid document type id", 400);
    const result = await this.communityAdminRepository.deleteDocumentType(id);
    log.info("document_type_deleted", { id, title: result.title, actor: session.userId });
    return result;
  }

  /** GET /report-reasons */
  async listReportReasons(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.communityAdminRepository.listReportReasons(skip, limit);
    return paged(items, page, limit, total);
  }

  /** POST /report-reasons */
  async addReportReason(session: Session, title: string) {
    if (!title) throw new ApiError("The title field is required.", 400);
    const row = await this.communityAdminRepository.addReportReason(title);
    log.info("report_reason_created", { id: row.id, title, actor: session.userId });
    return row;
  }

  /** PATCH /report-reasons/:id — legacy checked the title first and never
   *  validated the id (Number() → NaN passed through to Prisma). */
  async updateReportReason(session: Session, title: string, idRaw: string) {
    if (!title) throw new ApiError("The title field is required.", 400);
    const id = Number(idRaw);
    const row = await this.communityAdminRepository.updateReportReason(id, title);
    log.info("report_reason_updated", { id: row.id, title, actor: session.userId });
    return row;
  }

  /** DELETE /report-reasons/:id — id never validated (legacy). */
  async deleteReportReason(session: Session, idRaw: string) {
    const id = Number(idRaw);
    const row = await this.communityAdminRepository.deleteReportReason(id);
    log.info("report_reason_deleted", { id, actor: session.userId });
    return row;
  }

  /** GET /username-restrictions */
  async listUsernameRestrictions(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.communityAdminRepository.listUsernameRestrictions(skip, limit);
    return paged(items, page, limit, total);
  }

  /** POST /username-restrictions — single title or comma-separated batch. */
  async addUsernameRestrictions(session: Session, title: string) {
    if (!title) throw new ApiError("The title field is required.", 400);
    const items = await this.communityAdminRepository.addUsernameRestrictions(title);
    log.info("username_restrictions_created", { count: items.length, actor: session.userId });
    return { items };
  }

  /** PATCH /username-restrictions/:id — title first, id never validated. */
  async updateUsernameRestriction(session: Session, title: string, idRaw: string) {
    if (!title) throw new ApiError("The title field is required.", 400);
    const id = Number(idRaw);
    const row = await this.communityAdminRepository.updateUsernameRestriction(id, title);
    log.info("username_restriction_updated", { id: row.id, title, actor: session.userId });
    return row;
  }

  /** DELETE /username-restrictions/:id — id never validated (legacy). */
  async deleteUsernameRestriction(session: Session, idRaw: string) {
    const id = Number(idRaw);
    const row = await this.communityAdminRepository.deleteUsernameRestriction(id);
    log.info("username_restriction_deleted", { id, actor: session.userId });
    return row;
  }

  // ─── Profile verifications ──────────────────────────────────────────────

  /** GET /verifications (?status=pending|verified|not_verified&q=). */
  async listVerifications(
    filter: { q: string; status: string | undefined },
    page: number,
    limit: number
  ) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.communityAdminRepository.listVerifications({
      q: filter.q || undefined,
      status: filter.status,
      skip,
      take: limit,
    });
    return paged(items, page, limit, total);
  }

  /** GET /verifications/members — User rows with isVerified >= 2. */
  async listVerifiedMembers(q: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.communityAdminRepository.listVerifiedMembers({
      q: q || undefined,
      skip,
      take: limit,
    });
    return paged(items, page, limit, total);
  }

  /** POST /verifications/:userId/approve — sets isVerified=2. */
  async approveVerification(session: Session, userId: string) {
    if (!userId) throw new ApiError("User id is required", 400);
    const result = await this.communityAdminRepository.resolveVerification(session, userId, true);
    log.info("verification_approved", { userId, actor: session.userId });
    return result;
  }

  /** POST /verifications/:userId/reject — sets isVerified=0. */
  async rejectVerification(session: Session, userId: string) {
    if (!userId) throw new ApiError("User id is required", 400);
    const result = await this.communityAdminRepository.resolveVerification(session, userId, false);
    log.info("verification_rejected", { userId, actor: session.userId });
    return result;
  }

  // ─── Platform announcements (AdminNotification + push fan-out) ──────────

  /** GET /notifications */
  async listNotifications(q: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.communityAdminRepository.listAdminNotifications({
      q: q || undefined,
      skip,
      take: limit,
    });
    return paged(items, page, limit, total);
  }

  /** POST /notifications {title, description} — create + fan-out push. */
  async sendNotification(session: Session, title: string, description: string) {
    if (!title) throw new ApiError("The title field is required.", 400);
    if (!description) throw new ApiError("The description field is required.", 400);
    const result = await this.communityAdminRepository.sendAdminNotification(session, title, description);
    log.info("notification_sent", {
      notificationId: result.id,
      recipients: result.recipients,
      actor: session.userId,
    });
    return result;
  }

  /** PATCH /notifications/:id — title/description checks before the Number(id). */
  async updateNotification(session: Session, title: string, description: string, idRaw: string) {
    if (!title) throw new ApiError("The title field is required.", 400);
    if (!description) throw new ApiError("The description field is required.", 400);
    const notificationId = Number(idRaw);
    const result = await this.communityAdminRepository.updateAdminNotification(
      notificationId,
      title,
      description
    );
    log.info("notification_updated", { notificationId, actor: session.userId });
    return result;
  }

  /** POST /notifications/:id/repeat — re-fan-out (explicit overrides win). */
  async repeatNotification(
    session: Session,
    idRaw: string,
    title: string | undefined,
    description: string | undefined
  ) {
    const notificationId = Number(idRaw);
    const result = await this.communityAdminRepository.repeatAdminNotification(
      session,
      notificationId,
      title,
      description
    );
    log.info("notification_repeated", {
      notificationId,
      recipients: result.recipients,
      actor: session.userId,
    });
    return result;
  }

  /** DELETE /notifications/:id */
  async deleteNotification(session: Session, idRaw: string) {
    const notificationId = Number(idRaw);
    const row = await this.communityAdminRepository.deleteAdminNotification(notificationId);
    log.info("notification_deleted", { notificationId, actor: session.userId });
    return row;
  }
}
