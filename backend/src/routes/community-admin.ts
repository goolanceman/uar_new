/**
 * Community admin routes — /api/community/admin/* (GENERIC: shared by web +
 * mobile moderators).
 *
 * Moved out of the mobile compat module (src/routes/mobile/charity.ts) — same
 * business logic (src/lib/community/admin.ts), generic REST contract:
 * Bearer session auth with the ADMIN/MODERATOR role re-read from the DB, raw
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
 */
import { Router } from "express";
import { ApiError, handleError, json } from "@/lib/session";
import { logger } from "@/lib/logger";
import { paged, pageParams } from "@/lib/community/serializers";
import {
  requireElevated,
  adminUsers,
  adminPosts,
  adminReels,
  moderatePost,
  adminReports,
  resolveReport,
  adminCauses,
  adminDonations,
  listDocumentTypes,
  addDocumentType,
  updateDocumentType,
  deleteDocumentType,
  listReportReasons,
  addReportReason,
  updateReportReason,
  deleteReportReason,
  listUsernameRestrictions,
  addUsernameRestrictions,
  updateUsernameRestriction,
  deleteUsernameRestriction,
  listVerifications,
  listVerifiedMembers,
  resolveVerification,
  listAdminNotifications,
  sendAdminNotification,
  updateAdminNotification,
  repeatAdminNotification,
  deleteAdminNotification,
} from "@/lib/community/admin";

export const router = Router();

const log = logger.child("community:admin");

// GET /api/community/admin/users — members + charity profile + activity counts
router.get("/users", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 50);
    const q = String(req.query.q ?? "").trim();
    const tier = req.query.tier ? String(req.query.tier) : null;
    const { items, total } = await adminUsers(q, tier, skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/admin/posts — moderation list with per-post report counts
router.get("/posts", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 30);
    const q = String(req.query.q ?? "").trim();
    const type = req.query.type ? String(req.query.type) : null;
    const { items, total } = await adminPosts(q, type, skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/admin/reels — every reel with its transcode state.
// ?status= filters by pending_upload|uploaded|processing|ready|failed.
router.get("/reels", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 30);
    const q = String(req.query.q ?? "").trim();
    const status = req.query.status ? String(req.query.status) : null;
    const { items, total } = await adminReels(q, status, skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/community/admin/posts/moderate — verify/restrict/delete a post
router.post("/posts/moderate", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const body = req.body ?? {};
    const postId = String(body.postId ?? body.post_id ?? "");
    const action = String(body.action ?? "");
    const result = await moderatePost(session, postId, action);
    log.info("post_moderated", { postId, action, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/admin/reports — the moderation queue
router.get("/reports", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 30);
    const typeRaw = req.query.type;
    const type = typeRaw !== undefined && typeRaw !== "" ? Number(typeRaw) : null;
    const { items, total } = await adminReports(
      type !== null && Number.isFinite(type) ? type : null,
      skip,
      limit
    );
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/community/admin/reports/resolve — delete reported content / dismiss
router.post("/reports/resolve", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const body = req.body ?? {};
    const reportId = String(body.reportId ?? body.report_id ?? "");
    const action = String(body.action ?? "");
    const result = await resolveReport(session, reportId, action);
    log.info("report_resolved", { reportId, action, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/admin/causes — CommunityPost(type=cause) fundraising list
router.get("/causes", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 30);
    const q = String(req.query.q ?? "").trim();
    const { items, total, totalRaisedAll } = await adminCauses(q, skip, limit);
    return json(res, { ...paged(items, page, limit, total), totalRaisedAll });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/admin/donations — cause donations with the cause wire
router.get("/donations", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 30);
    const causePostId = req.query.causePostId ? String(req.query.causePostId) : req.query.cause_post_id ? String(req.query.cause_post_id) : null;
    const { items, total, totalRaised } = await adminDonations(causePostId, skip, limit);
    return json(res, { ...paged(items, page, limit, total), totalRaised });
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── Config lists — document types / report reasons / username restrictions ──

// GET /api/community/admin/document-types — titles served to the mobile app
// (KV-backed; id = array index).
router.get("/document-types", async (req, res) => {
  try {
    await requireElevated(req);
    return json(res, await listDocumentTypes());
  } catch (e) {
    return handleError(e, res);
  }
});

router.post("/document-types", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    const result = await addDocumentType(title);
    log.info("document_type_created", { id: result.id, title, actor: session.userId });
    return json(res, result, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

router.patch("/document-types/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const id = Number((req.params as Record<string, string>).id);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!Number.isInteger(id) || id < 0) throw new ApiError("Invalid document type id", 400);
    if (!title) throw new ApiError("The title field is required.", 400);
    const result = await updateDocumentType(id, title);
    log.info("document_type_updated", { id, title, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

router.delete("/document-types/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id < 0) throw new ApiError("Invalid document type id", 400);
    const result = await deleteDocumentType(id);
    log.info("document_type_deleted", { id, title: result.title, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── Report reasons ────────────────────────────────────────────────────────

router.get("/report-reasons", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 50);
    const { items, total } = await listReportReasons(skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

router.post("/report-reasons", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    const row = await addReportReason(title);
    log.info("report_reason_created", { id: row.id, title, actor: session.userId });
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

router.patch("/report-reasons/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    const id = Number((req.params as Record<string, string>).id);
    const row = await updateReportReason(id, title);
    log.info("report_reason_updated", { id: row.id, title, actor: session.userId });
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

router.delete("/report-reasons/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const id = Number((req.params as Record<string, string>).id);
    const row = await deleteReportReason(id);
    log.info("report_reason_deleted", { id, actor: session.userId });
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── Username restrictions ────────────────────────────────────────────────

router.get("/username-restrictions", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 50);
    const { items, total } = await listUsernameRestrictions(skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST accepts a single title or a comma-separated batch (legacy batch add).
router.post("/username-restrictions", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    const items = await addUsernameRestrictions(title);
    log.info("username_restrictions_created", { count: items.length, actor: session.userId });
    return json(res, { items }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

router.patch("/username-restrictions/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    const id = Number((req.params as Record<string, string>).id);
    const row = await updateUsernameRestriction(id, title);
    log.info("username_restriction_updated", { id: row.id, title, actor: session.userId });
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

router.delete("/username-restrictions/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const id = Number((req.params as Record<string, string>).id);
    const row = await deleteUsernameRestriction(id);
    log.info("username_restriction_deleted", { id, actor: session.userId });
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── Profile verifications ────────────────────────────────────────────────

// GET ?status=pending|verified|not_verified&q=
router.get("/verifications", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 30);
    const q = String(req.query.q ?? "").trim();
    const status = req.query.status ? String(req.query.status) : undefined;
    const { items, total } = await listVerifications({ q: q || undefined, status, skip, take: limit });
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// Verified members roster — User rows with isVerified >= 2.
router.get("/verifications/members", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 30);
    const q = String(req.query.q ?? "").trim();
    const { items, total } = await listVerifiedMembers({ q: q || undefined, skip, take: limit });
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /verifications/:userId/approve | /reject — sets the user's isVerified
// (2 verified | 0 not) and removes the pending request row.
router.post("/verifications/:userId/approve", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const userId = String((req.params as Record<string, string>).userId ?? "");
    if (!userId) throw new ApiError("User id is required", 400);
    const result = await resolveVerification(session, userId, true);
    log.info("verification_approved", { userId, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

router.post("/verifications/:userId/reject", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const userId = String((req.params as Record<string, string>).userId ?? "");
    if (!userId) throw new ApiError("User id is required", 400);
    const result = await resolveVerification(session, userId, false);
    log.info("verification_rejected", { userId, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── Platform announcements (AdminNotification + push fan-out) ────────────

router.get("/notifications", async (req, res) => {
  try {
    await requireElevated(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 20);
    const q = String(req.query.q ?? "").trim();
    const { items, total } = await listAdminNotifications({ q: q || undefined, skip, take: limit });
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /notifications {title, description} — create + fan-out push to every
// user with push notifications enabled.
router.post("/notifications", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const body = req.body ?? {};
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    if (!description) throw new ApiError("The description field is required.", 400);
    const result = await sendAdminNotification(session, title, description);
    log.info("notification_sent", {
      notificationId: result.id,
      recipients: result.recipients,
      actor: session.userId,
    });
    return json(res, result, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

router.patch("/notifications/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const body = req.body ?? {};
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    if (!description) throw new ApiError("The description field is required.", 400);
    const notificationId = Number((req.params as Record<string, string>).id);
    const result = await updateAdminNotification(notificationId, title, description);
    log.info("notification_updated", { notificationId, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /notifications/:id/repeat — re-fan-out an existing announcement
// (explicit title/description overrides win when provided).
router.post("/notifications/:id/repeat", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const body = req.body ?? {};
    const notificationId = Number((req.params as Record<string, string>).id);
    const result = await repeatAdminNotification(
      session,
      notificationId,
      body.title !== undefined ? String(body.title) : undefined,
      body.description !== undefined ? String(body.description) : undefined
    );
    log.info("notification_repeated", {
      notificationId,
      recipients: result.recipients,
      actor: session.userId,
    });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

router.delete("/notifications/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const notificationId = Number((req.params as Record<string, string>).id);
    const row = await deleteAdminNotification(notificationId);
    log.info("notification_deleted", { notificationId, actor: session.userId });
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});
