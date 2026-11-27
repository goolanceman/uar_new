/**
 * Community admin routes — thin endpoint definitions; all logic lives in
 * src/modules/community-admin (routes → controllers → services →
 * repositories). The historical export path (`@/routes/community-admin`) is
 * preserved: tests and the app entry import `router` from here.
 *
 * /api/community/admin/* (GENERIC: shared by web + mobile moderators).
 *
 * Moved out of the mobile compat module (src/routes/mobile/charity.ts) — same
 * business logic (src/lib/community/admin.ts), generic REST contract:
 * Bearer [redacted] auth with the ADMIN/MODERATOR role re-read from the DB, raw
 * JSON, camelCase fields, paged() lists, ApiError → {error}.
 *
 * Endpoints (legacy equivalent in brackets):
 *   GET  /users                     [GET /community/admin/users]
 *   GET  /posts                     [GET /community/admin/posts]
 *   POST /posts/moderate            [POST /community/admin/posts/moderate]
 *   GET  /reports                   [GET /community/admin/reports]
 *   POST /reports/resolve           [POST /community/admin/reports/resolve]
 *   GET  /causes                    [GET /community/admin/causes]
 *   GET  /donations                 [GET /community/admin/donations]
 *   GET/POST/PATCH/DELETE /document-types/:id  [addDocumentType/updateDocumentType/deleteDocumentType]
 *   GET/POST/PATCH/DELETE /report-reasons/:id  [reportReasonList/addreportReason/updateReportReason/deleteReportReasonType]
 *   GET/POST/PATCH/DELETE /username-restrictions/:id [RestrictionController]
 *   GET  /verifications (?status=&q=)      [profileVerificationList]
 *   GET  /verifications/members            [verified members roster]
 *   POST /verifications/:userId/approve|reject [approvedProfileVerification]
 *   GET/POST  /notifications          [adminNotificationList/sendNotification]
 *   PATCH/DELETE /notifications/:id   [updateNotification/deleteNotification]
 *   POST /notifications/:id/repeat    [repeatNotification]
 *
 * Every handler gated on `await requireElevated(req)` as its first step, so
 * the `elevated` middleware (same gate, attaches req.session) precedes each
 * route.
 */
import { Router } from "express";
import { elevated } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  adminBodySchema,
  adminDonationsQuerySchema,
  adminIdParamSchema,
  adminNotificationsQuerySchema,
  adminPostsQuerySchema,
  adminReelsQuerySchema,
  adminReportsQuerySchema,
  adminUserIdParamSchema,
  adminUsersQuerySchema,
  adminCausesQuerySchema,
  reportReasonsQuerySchema,
  usernameRestrictionsQuerySchema,
  verificationsQuerySchema,
  verifiedMembersQuerySchema,
} from "@/modules/community-admin/schemas/community-admin.schema";
import { communityAdminController } from "@/modules/community-admin";

export const router = Router();

// GET /api/community/admin/users — members + charity profile + activity counts
router.get("/users", elevated, validate({ query: adminUsersQuerySchema }), communityAdminController.listUsers);

// GET /api/community/admin/posts — moderation list with per-post report counts
router.get("/posts", elevated, validate({ query: adminPostsQuerySchema }), communityAdminController.listPosts);

// GET /api/community/admin/reels — every reel with its transcode state.
// ?status= filters by pending_upload|uploaded|processing|ready|failed.
router.get("/reels", elevated, validate({ query: adminReelsQuerySchema }), communityAdminController.listReels);

// POST /api/community/admin/posts/moderate — verify/restrict/delete a post
router.post(
  "/posts/moderate",
  elevated,
  validate({ body: adminBodySchema }),
  communityAdminController.moderate
);

// GET /api/community/admin/reports — the moderation queue
router.get("/reports", elevated, validate({ query: adminReportsQuerySchema }), communityAdminController.listReports);

// POST /api/community/admin/reports/resolve — delete reported content / dismiss
router.post(
  "/reports/resolve",
  elevated,
  validate({ body: adminBodySchema }),
  communityAdminController.resolveReport
);

// GET /api/community/admin/causes — CommunityPost(type=cause) fundraising list
router.get("/causes", elevated, validate({ query: adminCausesQuerySchema }), communityAdminController.listCauses);

// GET /api/community/admin/donations — cause donations with the cause wire
router.get(
  "/donations",
  elevated,
  validate({ query: adminDonationsQuerySchema }),
  communityAdminController.listDonations
);

// ─── Config lists — document types / report reasons / username restrictions ──

// GET /api/community/admin/document-types — titles served to the mobile app
// (KV-backed; id = array index).
router.get("/document-types", elevated, communityAdminController.listDocumentTypes);

router.post(
  "/document-types",
  elevated,
  validate({ body: adminBodySchema }),
  communityAdminController.addDocumentType
);

router.patch(
  "/document-types/:id",
  elevated,
  validate({ params: adminIdParamSchema, body: adminBodySchema }),
  communityAdminController.updateDocumentType
);

router.delete(
  "/document-types/:id",
  elevated,
  validate({ params: adminIdParamSchema }),
  communityAdminController.deleteDocumentType
);

// ─── Report reasons ────────────────────────────────────────────────────────

router.get(
  "/report-reasons",
  elevated,
  validate({ query: reportReasonsQuerySchema }),
  communityAdminController.listReportReasons
);

router.post(
  "/report-reasons",
  elevated,
  validate({ body: adminBodySchema }),
  communityAdminController.addReportReason
);

router.patch(
  "/report-reasons/:id",
  elevated,
  validate({ params: adminIdParamSchema, body: adminBodySchema }),
  communityAdminController.updateReportReason
);

router.delete(
  "/report-reasons/:id",
  elevated,
  validate({ params: adminIdParamSchema }),
  communityAdminController.deleteReportReason
);

// ─── Username restrictions ────────────────────────────────────────────────

router.get(
  "/username-restrictions",
  elevated,
  validate({ query: usernameRestrictionsQuerySchema }),
  communityAdminController.listUsernameRestrictions
);

// POST accepts a single title or a comma-separated batch (legacy batch add).
router.post(
  "/username-restrictions",
  elevated,
  validate({ body: adminBodySchema }),
  communityAdminController.addUsernameRestrictions
);

router.patch(
  "/username-restrictions/:id",
  elevated,
  validate({ params: adminIdParamSchema, body: adminBodySchema }),
  communityAdminController.updateUsernameRestriction
);

router.delete(
  "/username-restrictions/:id",
  elevated,
  validate({ params: adminIdParamSchema }),
  communityAdminController.deleteUsernameRestriction
);

// ─── Profile verifications ────────────────────────────────────────────────

// GET ?status=pending|verified|not_verified&q=
router.get(
  "/verifications",
  elevated,
  validate({ query: verificationsQuerySchema }),
  communityAdminController.listVerifications
);

// Verified members roster — User rows with isVerified >= 2.
router.get(
  "/verifications/members",
  elevated,
  validate({ query: verifiedMembersQuerySchema }),
  communityAdminController.listVerifiedMembers
);

// POST /verifications/:userId/approve | /reject — sets the user's isVerified
// (2 verified | 0 not) and removes the pending request row.
router.post(
  "/verifications/:userId/approve",
  elevated,
  validate({ params: adminUserIdParamSchema }),
  communityAdminController.approveVerification
);

router.post(
  "/verifications/:userId/reject",
  elevated,
  validate({ params: adminUserIdParamSchema }),
  communityAdminController.rejectVerification
);

// ─── Platform announcements (AdminNotification + push fan-out) ────────────

router.get(
  "/notifications",
  elevated,
  validate({ query: adminNotificationsQuerySchema }),
  communityAdminController.listNotifications
);

// POST /notifications {title, description} — create + fan-out push to every
// user with push notifications enabled.
router.post(
  "/notifications",
  elevated,
  validate({ body: adminBodySchema }),
  communityAdminController.sendNotification
);

router.patch(
  "/notifications/:id",
  elevated,
  validate({ params: adminIdParamSchema, body: adminBodySchema }),
  communityAdminController.updateNotification
);

// POST /notifications/:id/repeat — re-fan-out an existing announcement
// (explicit title/description overrides win when provided).
router.post(
  "/notifications/:id/repeat",
  elevated,
  validate({ params: adminIdParamSchema, body: adminBodySchema }),
  communityAdminController.repeatNotification
);

router.delete(
  "/notifications/:id",
  elevated,
  validate({ params: adminIdParamSchema }),
  communityAdminController.deleteNotification
);
