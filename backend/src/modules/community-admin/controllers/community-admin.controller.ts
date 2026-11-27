/**
 * Community admin controller — HTTP layer only. Extracts validated data /
 * session, applies the legacy's hand-rolled field coercions verbatim,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  AdminBody,
  AdminCausesQuery,
  AdminDonationsQuery,
  AdminIdParams,
  AdminNotificationsQuery,
  AdminPostsQuery,
  AdminReportsQuery,
  AdminReelsQuery,
  AdminUserIdParams,
  AdminUsersQuery,
  VerificationsQuery,
  VerifiedMembersQuery,
} from "../schemas/community-admin.schema";
import type { CommunityAdminService } from "../services/community-admin.service";

/** Legacy truthy→String query coercion (`req.query.x ? String(...) : null`). */
function strOrNull(v: unknown): string | null {
  return v ? String(v) : null;
}

export class CommunityAdminController {
  constructor(private readonly communityAdminService: CommunityAdminService) {}

  /** GET /users — members + charity profile + activity counts */
  listUsers: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<AdminUsersQuery>(req);
      const payload = await this.communityAdminService.listUsers(
        String(query.q ?? "").trim(),
        query.tier ? String(query.tier) : null,
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /posts — moderation list with per-post report counts */
  listPosts: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<AdminPostsQuery>(req);
      const payload = await this.communityAdminService.listPosts(
        String(query.q ?? "").trim(),
        strOrNull(query.type),
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /reels — every reel with its transcode state (?status= filter) */
  listReels: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<AdminReelsQuery>(req);
      const payload = await this.communityAdminService.listReels(
        String(query.q ?? "").trim(),
        strOrNull(query.status),
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /posts/moderate — verify/restrict/delete a post */
  moderate: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<AdminBody>(req) ?? {};
      const result = await this.communityAdminService.moderate(
        req.session!,
        String(body.postId ?? body.post_id ?? ""),
        String(body.action ?? "")
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /reports — the moderation queue */
  listReports: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<AdminReportsQuery>(req);
      const payload = await this.communityAdminService.listReports(query.type, query.page, query.limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /reports/resolve — delete reported content / dismiss */
  resolveReport: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<AdminBody>(req) ?? {};
      const result = await this.communityAdminService.resolveReport(
        req.session!,
        String(body.reportId ?? body.report_id ?? ""),
        String(body.action ?? "")
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /causes — CommunityPost(type=cause) fundraising list */
  listCauses: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<AdminCausesQuery>(req);
      const payload = await this.communityAdminService.listCauses(
        String(query.q ?? "").trim(),
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /donations — cause donations with the cause wire */
  listDonations: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<AdminDonationsQuery>(req);
      const causePostId = query.causePostId
        ? String(query.causePostId)
        : query.cause_post_id
          ? String(query.cause_post_id)
          : null;
      const payload = await this.communityAdminService.listDonations(causePostId, query.page, query.limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  // ─── Config lists — document types / report reasons / username restrictions ─

  /** GET /document-types */
  listDocumentTypes: RequestHandler = async (_req, res, next) => {
    try {
      res.json(await this.communityAdminService.listDocumentTypes());
    } catch (error) {
      next(error);
    }
  };

  /** POST /document-types */
  addDocumentType: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<AdminBody>(req) ?? {};
      const result = await this.communityAdminService.addDocumentType(
        req.session!,
        String(body.title ?? "").trim()
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /document-types/:id */
  updateDocumentType: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AdminIdParams>(req);
      const body = validatedBody<AdminBody>(req) ?? {};
      const result = await this.communityAdminService.updateDocumentType(
        req.session!,
        id,
        String(body.title ?? "").trim()
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /document-types/:id */
  deleteDocumentType: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AdminIdParams>(req);
      const result = await this.communityAdminService.deleteDocumentType(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /report-reasons */
  listReportReasons: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<{ page: number; limit: number }>(req);
      const payload = await this.communityAdminService.listReportReasons(query.page, query.limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /report-reasons */
  addReportReason: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<AdminBody>(req) ?? {};
      const row = await this.communityAdminService.addReportReason(
        req.session!,
        String(body.title ?? "").trim()
      );
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /report-reasons/:id */
  updateReportReason: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AdminIdParams>(req);
      const body = validatedBody<AdminBody>(req) ?? {};
      const row = await this.communityAdminService.updateReportReason(
        req.session!,
        String(body.title ?? "").trim(),
        id
      );
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /report-reasons/:id */
  deleteReportReason: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AdminIdParams>(req);
      const row = await this.communityAdminService.deleteReportReason(req.session!, id);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** GET /username-restrictions */
  listUsernameRestrictions: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<{ page: number; limit: number }>(req);
      const payload = await this.communityAdminService.listUsernameRestrictions(query.page, query.limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /username-restrictions — single title or comma-separated batch */
  addUsernameRestrictions: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<AdminBody>(req) ?? {};
      const result = await this.communityAdminService.addUsernameRestrictions(
        req.session!,
        String(body.title ?? "").trim()
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /username-restrictions/:id */
  updateUsernameRestriction: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AdminIdParams>(req);
      const body = validatedBody<AdminBody>(req) ?? {};
      const row = await this.communityAdminService.updateUsernameRestriction(
        req.session!,
        String(body.title ?? "").trim(),
        id
      );
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /username-restrictions/:id */
  deleteUsernameRestriction: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AdminIdParams>(req);
      const row = await this.communityAdminService.deleteUsernameRestriction(req.session!, id);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  // ─── Profile verifications ────────────────────────────────────────────────

  /** GET /verifications (?status=pending|verified|not_verified&q=) */
  listVerifications: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<VerificationsQuery>(req);
      const payload = await this.communityAdminService.listVerifications(
        { q: String(query.q ?? "").trim(), status: query.status ? String(query.status) : undefined },
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /verifications/members — verified members roster */
  listVerifiedMembers: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<VerifiedMembersQuery>(req);
      const payload = await this.communityAdminService.listVerifiedMembers(
        String(query.q ?? "").trim(),
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /verifications/:userId/approve */
  approveVerification: RequestHandler = async (req, res, next) => {
    try {
      const { userId } = validatedParams<AdminUserIdParams>(req);
      const result = await this.communityAdminService.approveVerification(req.session!, String(userId ?? ""));
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /verifications/:userId/reject */
  rejectVerification: RequestHandler = async (req, res, next) => {
    try {
      const { userId } = validatedParams<AdminUserIdParams>(req);
      const result = await this.communityAdminService.rejectVerification(req.session!, String(userId ?? ""));
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // ─── Platform announcements (AdminNotification + push fan-out) ────────────

  /** GET /notifications */
  listNotifications: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<AdminNotificationsQuery>(req);
      const payload = await this.communityAdminService.listNotifications(
        String(query.q ?? "").trim(),
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /notifications {title, description} — create + fan-out push */
  sendNotification: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<AdminBody>(req) ?? {};
      const result = await this.communityAdminService.sendNotification(
        req.session!,
        String(body.title ?? "").trim(),
        String(body.description ?? "").trim()
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /notifications/:id */
  updateNotification: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AdminIdParams>(req);
      const body = validatedBody<AdminBody>(req) ?? {};
      const result = await this.communityAdminService.updateNotification(
        req.session!,
        String(body.title ?? "").trim(),
        String(body.description ?? "").trim(),
        id
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /notifications/:id/repeat — re-fan-out an existing announcement */
  repeatNotification: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AdminIdParams>(req);
      const body = validatedBody<AdminBody>(req) ?? {};
      const result = await this.communityAdminService.repeatNotification(
        req.session!,
        id,
        body.title !== undefined ? String(body.title) : undefined,
        body.description !== undefined ? String(body.description) : undefined
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /notifications/:id */
  deleteNotification: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AdminIdParams>(req);
      const row = await this.communityAdminService.deleteNotification(req.session!, id);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };
}
