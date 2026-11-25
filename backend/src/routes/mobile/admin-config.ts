/**
 * Mobile community ADMIN routes — admin-config module (PHP admin panel parity).
 * Mounted under /api via routes/mobile/index.ts. Auth: mobileAuth (JWT — the
 * admin dashboard sends Authorization: Bearer; mobile admin users send
 * authtoken) + an ADMIN/MODERATOR role gate, mirroring the legacy checkLogin.
 *
 * Ports the legacy admin-panel config screens onto the same storage the mobile
 * /api/fetchSetting reads, so dashboard edits are reflected in the app
 * immediately:
 *   SettingsController     → /community/admin/settings (GET reads the
 *                            "mobile.app" Setting KV exactly like
 *                            SettingsController::fetchSetting; POST merges any
 *                            subset of keys like updateSettings — legacy
 *                            changeAppName is just an app_name update),
 *                            document types live in the "mobile.documentTypes"
 *                            Setting KV (JSON array of title strings, id=index)
 *                            mirroring addDocumentType/updateDocumentType/
 *                            deleteDocumentType,
 *   ReportReason CRUD      → addreportReason/reportReasonList/updateReportReason/
 *                            deleteReportReasonType,
 *   RestrictionController  → addUsernameRestrict/updateUsernameRestrict/
 *                            deleteUsernameRestrictions (comma-separated batch
 *                            add included),
 *   InterestController     → addInterest/updateInterest/deleteInterest.
 *
 * Deliberate extension over the legacy deleteInterest (which only deleted the
 * row and left dangling ids in the CSV columns): the delete also strips the id
 * from users.interestIds, communityPost/communityReel/communityRoom
 * interestIds so nothing references a dead interest.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@/lib/db";
import {
  data,
  fail,
  mobileAuth,
  ok,
  session,
  params,
  str,
  num,
  optStr,
  bool,
  csvToInts,
  csvHas,
  intsToCsv,
  feedEvent,
  mobileErrorHandler,
} from "@/lib/mobile/compat";
import type { Session } from "@/lib/session";

export const router = Router();

/** wrap() single-handler form — lets middleware (mobileAuth) run first. */
function h(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) =>
    Promise.resolve(handler(req, res)).catch((e) => mobileErrorHandler(e, res));
}

/** Session with an elevated role (admin dashboard endpoints) — same gate as
 *  the admin section of charity.ts. */
function requireElevated(req: Request, res: Response): Session | null {
  try {
    const s = session(req);
    if (s.role !== "ADMIN" && s.role !== "MODERATOR") {
      unauthorizedRes(res);
      return null;
    }
    return s;
  } catch {
    unauthorizedRes(res);
    return null;
  }
}

function unauthorizedRes(res: Response) {
  res.status(401).json({ status: false, message: "Unauthorized Access" });
}

// ─── mobile.app Setting KV (what fetchSetting reads) ──────────────────────────

const APP_KV_KEY = "mobile.app";
const DOCS_KV_KEY = "mobile.documentTypes";
const APP_KV_DESC = "Mobile app config served by /api/fetchSetting";
const DOCS_KV_DESC = "Profile verification document types for the mobile app";

/** updateSettings whitelists — mirror the legacy $request->has(...) branches. */

/** Plain string columns. */
const SETTING_STRINGS = [
  "app_name",
  "support_email",
  "uri_scheme",
  "play_store_download_link",
  "app_store_download_link",
  "android_app_version",
  "ios_app_version",
  "ad_banner_android",
  "ad_interstitial_android",
  "ad_banner_iOS",
  "ad_interstitial_iOS",
] as const;

/** Nullable string columns (maintenance_message, SightEngine credentials). */
const SETTING_NULLABLE_STRINGS = [
  "maintenance_message",
  "sight_engine_api_user",
  "sight_engine_api_secret",
  "sight_engine_image_workflow_id",
  "sight_engine_video_workflow_id",
] as const;

/** Numeric limit columns. */
const SETTING_NUMBERS = [
  "setRoomUsersLimit",
  "minute_limit_in_creating_story",
  "minute_limit_in_audio_post",
  "minute_limit_in_choosing_video_for_story",
  "minute_limit_in_choosing_video_for_post",
  "max_images_can_be_uploaded_in_one_post",
  "audio_space_hosts_limit",
  "audio_space_listeners_limit",
  "audio_space_duration_in_minutes",
  "duration_limit_in_reel",
  "storage_type",
  "fetch_post_type",
] as const;

/** Feature flags — the Flutter model parses int?, so serialize 0/1 ints. */
const SETTING_FLAGS = [
  "is_admob_on",
  "is_sight_engine_enabled",
  "is_in_app_purchase_enabled",
  "is_maintenance_mode",
  "is_force_app_update",
] as const;

async function readAppKv(): Promise<{ row: { createdAt: Date; updatedAt: Date }; settings: Record<string, unknown> } | null> {
  const row = await db.setting.findUnique({ where: { key: APP_KV_KEY } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return { row, settings: parsed as Record<string, unknown> };
  } catch {
    return null;
  }
}

async function writeAppKv(settings: Record<string, unknown>): Promise<void> {
  const value = JSON.stringify(settings);
  await db.setting.upsert({
    where: { key: APP_KV_KEY },
    update: { value },
    create: { key: APP_KV_KEY, value, description: APP_KV_DESC },
  });
}

/** The documentTypes KV is a JSON array of title strings; fetchSetting assigns
 *  id = array index when nesting them, so the index IS the id. */
async function readDocKv(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: DOCS_KV_KEY } });
  try {
    const parsed = JSON.parse(row?.value ?? "[]");
    if (Array.isArray(parsed)) return parsed.map((t) => str(t));
  } catch {
    // missing/corrupt KV row → empty list
  }
  return [];
}

async function writeDocKv(titles: string[]): Promise<void> {
  const value = JSON.stringify(titles);
  await db.setting.upsert({
    where: { key: DOCS_KV_KEY },
    update: { value },
    create: { key: DOCS_KV_KEY, value, description: DOCS_KV_DESC },
  });
}

/** Shared serializer shape with fetchSetting's nested lists. */
function kvRowShape(id: number, title: string, createdAt: Date | null, updatedAt: Date | null) {
  return {
    id,
    title,
    created_at: createdAt ? createdAt.toISOString() : null,
    updated_at: updatedAt ? updatedAt.toISOString() : null,
  };
}

/** Legacy duplicate-title guard shared by every list CRUD (PHP checked
 *  where('title', $request->title)->first() before writing). */
async function titleTaken(
  model: "communityInterest" | "reportReason" | "usernameRestriction",
  title: string,
  excludeId?: number
): Promise<boolean> {
  const where = { title, ...(excludeId !== undefined ? { id: { not: excludeId } } : {}) };
  const row = await (db[model] as typeof db.communityInterest).findFirst({ where, select: { id: true } });
  return !!row;
}

// ══════════════════════════════ App settings ═════════════════════════════════

router.get("/mobile-admin/settings", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const kv = await readAppKv();
  if (!kv) return fail(res, "Settings not configured");
  // The raw mobile.app blob — the same keys /api/fetchSetting spreads at the
  // top level, without the nested lists it appends.
  return data(res, "Settings retrieved", kv.settings);
}));

router.post("/mobile-admin/settings", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const kv = await readAppKv();
  if (!kv) return fail(res, "Settings not configured");
  const p = params(req);

  const next: Record<string, unknown> = { ...kv.settings };
  const touched: string[] = [];

  for (const key of SETTING_STRINGS) {
    if (p[key] !== undefined) {
      next[key] = str(p[key]);
      touched.push(key);
    }
  }
  for (const key of SETTING_NULLABLE_STRINGS) {
    if (p[key] !== undefined) {
      next[key] = optStr(p[key]);
      touched.push(key);
    }
  }
  for (const key of SETTING_NUMBERS) {
    if (p[key] !== undefined) {
      next[key] = num(p[key]);
      touched.push(key);
    }
  }
  for (const key of SETTING_FLAGS) {
    if (p[key] !== undefined) {
      next[key] = bool(p[key]) ? 1 : 0; // Flutter model parses int?, not bool
      touched.push(key);
    }
  }

  if (touched.length === 0) return fail(res, "No settings fields provided");

  await writeAppKv(next);
  feedEvent("app.settings.updated", { keys: touched, by: s.userId });
  return ok(res, "Setting Updated Successfully", { settings: next });
}));

// ══════════════════════════════ Document types ═══════════════════════════════
// Stored in the "mobile.documentTypes" KV as a JSON array of title strings;
// the mobile fetchSetting nests them with id = array index.

router.get("/mobile-admin/document-types", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const titles = await readDocKv();
  return data(res, "Document types retrieved", {
    document_types: titles.map((title, id) => kvRowShape(id, title, null, null)),
    total_count: titles.length,
  });
}));

router.post("/mobile-admin/document-types", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const title = str(p.title).trim();
  if (!title) return fail(res, "The title field is required.");

  const titles = await readDocKv();
  if (titles.includes(title)) return fail(res, "Document Record Dublicate"); // legacy message
  titles.push(title);
  await writeDocKv(titles);
  feedEvent("app.document_types.updated", { action: "add", title });
  return ok(res, "Document Added Successfully", { document_type: kvRowShape(titles.length - 1, title, null, null) });
}));

router.post("/mobile-admin/document-types/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = num(p.id, -1);
  const title = str(p.title).trim();
  if (!title) return fail(res, "The title field is required.");

  const titles = await readDocKv();
  if (id < 0 || id >= titles.length) return fail(res, "Document Type Not Found");
  if (titles.includes(title)) return fail(res, "Document Record Dublicate"); // legacy message
  titles[id] = title;
  await writeDocKv(titles);
  feedEvent("app.document_types.updated", { action: "update", id, title });
  return ok(res, "Document Type Updated Successfully");
}));

router.post("/mobile-admin/document-types/delete", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const id = num(params(req).id, -1);

  const titles = await readDocKv();
  if (id < 0 || id >= titles.length) return fail(res, "Document Type Not Found");
  titles.splice(id, 1);
  await writeDocKv(titles);
  feedEvent("app.document_types.updated", { action: "delete", id });
  return ok(res, "Document Type Delete Successfully");
}));

// ══════════════════════════════ Report reasons ═══════════════════════════════
// ReportReason model — addreportReason/reportReasonList/updateReportReason/
// deleteReportReasonType in the legacy SettingsController.

router.get("/mobile-admin/report-reasons", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const rows = await db.reportReason.findMany({ orderBy: { id: "desc" } }); // legacy list ordered id DESC
  return data(res, "Report reasons retrieved", {
    report_reasons: rows.map((r) => ({ id: r.id, title: r.title, created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString() })),
    total_count: rows.length,
  });
}));

router.post("/mobile-admin/report-reasons", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const title = str(p.title).trim();
  if (!title) return fail(res, "The title field is required.");
  if (await titleTaken("reportReason", title)) return fail(res, "Report Reason Dublicate");

  const row = await db.reportReason.create({ data: { title } });
  feedEvent("app.report_reasons.updated", { action: "add", id: row.id });
  return ok(res, "Reason Added Successfully", {
    report_reason: { id: row.id, title: row.title, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString() },
  });
}));

router.post("/mobile-admin/report-reasons/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = num(p.id, -1);
  const title = str(p.title).trim();
  if (!title) return fail(res, "The title field is required.");

  const row = await db.reportReason.findUnique({ where: { id } });
  if (!row) return fail(res, "Reason Not Found");
  if (await titleTaken("reportReason", title, id)) return fail(res, "Reason Already Exist");

  await db.reportReason.update({ where: { id }, data: { title } });
  feedEvent("app.report_reasons.updated", { action: "update", id });
  return ok(res, "Report Reason Updated Successfully");
}));

router.post("/mobile-admin/report-reasons/delete", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  // Legacy deleteReportReasonType read $request->reportReason_id.
  const p = params(req);
  const id = num(p.report_reason_id ?? p.reportReason_id ?? p.id, -1);

  const row = await db.reportReason.findUnique({ where: { id } });
  if (!row) return fail(res, "Report Reason not found");
  await db.reportReason.delete({ where: { id } });
  feedEvent("app.report_reasons.updated", { action: "delete", id });
  return ok(res, "Report Reason Delete Successfully");
}));

// ══════════════════════════ Username restrictions ════════════════════════════
// UsernameRestriction model — RestrictionController (addUsernameRestrict also
// accepted a comma-separated list and created one row per entry).

router.get("/mobile-admin/username-restrictions", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const rows = await db.usernameRestriction.findMany({ orderBy: { id: "desc" } }); // legacy list ordered id DESC
  return data(res, "Username restrictions retrieved", {
    username_restrictions: rows.map((r) => ({ id: r.id, title: r.title, created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString() })),
    total_count: rows.length,
  });
}));

router.post("/mobile-admin/username-restrictions", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const title = str(p.title).trim();
  if (!title) return fail(res, "The title field is required.");

  // PHP checked the whole input first ("Username is already exist!"), then
  // split on commas and created one row per entry.
  if (await titleTaken("usernameRestriction", title)) return fail(res, "Username is already exist!");

  const parts = title.includes(",")
    ? title.split(",").map((t) => t.trim()).filter(Boolean)
    : [title];
  const created = [];
  for (const part of parts) {
    created.push(await db.usernameRestriction.create({ data: { title: part } }));
  }
  feedEvent("app.username_restrictions.updated", { action: "add", count: created.length });
  return ok(res, "Username Add Successfully", {
    username_restriction: {
      id: created[created.length - 1].id,
      title: created[created.length - 1].title,
      created_at: created[created.length - 1].createdAt.toISOString(),
      updated_at: created[created.length - 1].updatedAt.toISOString(),
    },
  });
}));

router.post("/mobile-admin/username-restrictions/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  // Legacy updateUsernameRestrict read $request->username_id.
  const id = num(p.username_id ?? p.id, -1);
  const title = str(p.title).trim();
  if (!title) return fail(res, "The title field is required.");

  const row = await db.usernameRestriction.findUnique({ where: { id } });
  if (!row) return fail(res, "Username not found");

  await db.usernameRestriction.update({ where: { id }, data: { title } });
  feedEvent("app.username_restrictions.updated", { action: "update", id });
  return ok(res, "Username Updated Successfully");
}));

router.post("/mobile-admin/username-restrictions/delete", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = num(p.username_id ?? p.id, -1);

  const row = await db.usernameRestriction.findUnique({ where: { id } });
  if (!row) return fail(res, "Username not found");
  await db.usernameRestriction.delete({ where: { id } });
  feedEvent("app.username_restrictions.updated", { action: "delete", id });
  return ok(res, "Username Deleted Successfully");
}));

// ════════════════════════════════ Interests ══════════════════════════════════
// CommunityInterest model — InterestController (addInterest/updateInterest/
// deleteInterest). The legacy delete only removed the row; here the id is also
// stripped from the interestIds CSV columns so nothing references a dead
// interest.

router.get("/mobile-admin/interests", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const rows = await db.communityInterest.findMany({ orderBy: { id: "desc" } }); // legacy list ordered id DESC
  return data(res, "Interests retrieved", {
    interests: rows.map((i) => ({ id: i.id, title: i.title, created_at: i.createdAt.toISOString(), updated_at: i.updatedAt.toISOString() })),
    total_count: rows.length,
  });
}));

router.post("/mobile-admin/interests", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const title = str(p.title).trim();
  if (!title) return fail(res, "The title field is required.");
  if (await titleTaken("communityInterest", title)) return fail(res, "interest Record Dublicate");

  const row = await db.communityInterest.create({ data: { title } });
  feedEvent("app.interests.updated", { action: "add", id: row.id });
  return ok(res, "interest Added Successfully", {
    interest: { id: row.id, title: row.title, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString() },
  });
}));

router.post("/mobile-admin/interests/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  // Legacy updateInterest read $request->interest_id.
  const id = num(p.interest_id ?? p.id, -1);
  const title = str(p.title).trim();
  if (!title) return fail(res, "The title field is required.");

  const row = await db.communityInterest.findUnique({ where: { id } });
  if (!row) return fail(res, "Interest Not Found");
  if (await titleTaken("communityInterest", title, id)) return fail(res, "interest Record Dublicate");

  await db.communityInterest.update({ where: { id }, data: { title } });
  feedEvent("app.interests.updated", { action: "update", id });
  return ok(res, "Interest Updated Successfully");
}));

/** Rewrite one interestIds CSV column dropping interestId (rows are re-read and
 *  filtered in JS — exact CSV membership, not a substring match). Rows are
 *  always written back with the recomputed CSV — an empty string when the last
 *  reference is removed, which suits both the nullable (user/post/reel) and
 *  non-nullable (room) columns. */
async function stripInterest(model: "user" | "communityPost" | "communityReel" | "communityRoom", interestId: number): Promise<number> {
  const rows = await (db[model] as typeof db.user).findMany({
    select: { id: true, interestIds: true },
  });
  let updated = 0;
  for (const r of rows) {
    if (!csvHas(r.interestIds, interestId)) continue;
    const next = intsToCsv(csvToInts(r.interestIds).filter((n) => n !== interestId));
    await (db[model] as typeof db.user).update({
      where: { id: r.id },
      data: { interestIds: next },
    });
    updated++;
  }
  return updated;
}

router.post("/mobile-admin/interests/delete", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = num(p.interest_id ?? p.id, -1);

  const row = await db.communityInterest.findUnique({ where: { id } });
  if (!row) return fail(res, "Interest Not Found");

  await db.communityInterest.delete({ where: { id } });
  const stripped =
    (await stripInterest("user", id)) +
    (await stripInterest("communityPost", id)) +
    (await stripInterest("communityReel", id)) +
    (await stripInterest("communityRoom", id));
  feedEvent("app.interests.updated", { action: "delete", id, stripped_refs: stripped });
  return ok(res, "Interest Delete Successfully", { stripped_refs: stripped });
}));
