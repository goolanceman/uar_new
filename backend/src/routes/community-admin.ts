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
 *   GET  /users              [GET /community/admin/users]
 *   GET  /posts              [GET /community/admin/posts]
 *   POST /posts/moderate     [POST /community/admin/posts/moderate]
 *   GET  /reports            [GET /community/admin/reports]
 *   POST /reports/resolve    [POST /community/admin/reports/resolve]
 *   GET  /causes             [GET /community/admin/causes]
 *   GET  /donations          [GET /community/admin/donations]
 */
import { Router } from "express";
import { handleError, json } from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import {
  requireElevated,
  adminUsers,
  adminPosts,
  moderatePost,
  adminReports,
  resolveReport,
  adminCauses,
  adminDonations,
} from "@/lib/community/admin";

export const router = Router();

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

// POST /api/community/admin/posts/moderate — verify/restrict/delete a post
router.post("/posts/moderate", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const body = req.body ?? {};
    const postId = String(body.postId ?? body.post_id ?? "");
    const action = String(body.action ?? "");
    return json(res, await moderatePost(session, postId, action));
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
    return json(res, await resolveReport(session, reportId, action));
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
