/**
 * Mobile community ADMIN routes — admin-engage module (PHP admin panel parity).
 * Mounted under /api via routes/mobile/index.ts. Auth: mobileAuth (JWT — the
 * admin dashboard sends Authorization: Bearer; mobile admin users send
 * authtoken) + an ADMIN/MODERATOR role gate, mirroring the legacy checkLogin.
 *
 * Ports the legacy admin-panel engagement screens:
 *   AdminController     → /community/admin/notifications/send
 *                         (sendNotification: create AdminNotification + push
 *                         to ALL users — legacy
 *                         GlobalFunction::sendPushNotificationToAllUsers sent
 *                         FCM to the 'chatter' topic; here every push-enabled
 *                         user gets a Notification row via sendPush() so the
 *                         mobile notifications list keeps working, with FCM
 *                         delivery when a device token + server key exist),
 *                         /community/admin/notifications (adminNotificationList,
 *                         paginated newest first + title/description search),
 *                         /update (updateNotification), /repeat
 *                         (repeatNotification — re-fan-out an existing
 *                         notification), /delete (deleteNotification, hard).
 *   FAQsController      → /community/admin/faqs (fetchFAQs: FaqType
 *                         is_deleted=0 with nested faqs, newest first),
 *                         /types/add | /types/update | /types/delete
 *                         (addFAQsType duplicate-title guard kept; the legacy
 *                         deleteFAQsType HARD-deletes the type AND its nested
 *                         faqs — ported as-is), /faqs/add | /faqs/update |
 *                         /faqs/delete (legacy deleteFAQs is a hard delete).
 *   SettingsController  → /community/admin/chart (fetchAllChartData's
 *                         group-by-day counts, adapted to a fixed trailing
 *                         14-day window instead of month/year).
 *
 * After every send/repeat the admin live feed gets an event (feedEvent) and
 * the legacy wire messages are preserved verbatim (including the legacy
 * "Notification has been send" wording).
 */
import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  data,
  fail,
  mobileAuth,
  ok,
  page,
  params,
  sendPush,
  session,
  feedEvent,
  str,
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

/** Legacy param spellings: updateNotification used `notificationID`,
 *  deleteNotification `notification_id` — accept both everywhere. */
function notificationId(p: Record<string, unknown>): string {
  return str(p.notification_id) || str(p.notificationID);
}

// ─── Push fan-out (legacy GlobalFunction::sendPushNotificationToAllUsers) ─────

/**
 * Send a platform notification to every user with isPushNotifications=1.
 * Legacy blasted one FCM message to the topic 'chatter'; per-user rows keep
 * the mobile notifications list working, so sendPush() per user (batched to
 * bound concurrency). Returns the number of users reached.
 */
async function fanOutPush(title: string, description: string): Promise<number> {
  const users = await db.user.findMany({
    where: { isPushNotifications: 1 },
    select: { id: true },
  });
  const BATCH = 50;
  let sent = 0;
  for (let i = 0; i < users.length; i += BATCH) {
    const batch = users.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((u) => sendPush({ userId: u.id, title, body: description, type: "ADMIN" }))
    );
    sent += results.filter((r) => r.status === "fulfilled").length;
  }
  return sent;
}

// ─── Platform notifications (AdminController) ─────────────────────────────────

// POST /community/admin/notifications/send {title, description} — sendNotification
router.post("/mobile-admin/notifications/send", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const title = str(p.title).trim();
  const description = str(p.description).trim();
  if (!title) return fail(res, "The title field is required.");
  if (!description) return fail(res, "The description field is required.");

  const row = await db.adminNotification.create({ data: { title, description } });
  const recipients = await fanOutPush(title, description);
  feedEvent("notification.sent", { id: row.id, title, recipients, by: s.userId });
  return ok(res, "Notification has been send");
}));

// GET /community/admin/notifications — adminNotificationList (paginated, newest first)
router.get("/mobile-admin/notifications", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit } = page(req, 20);
  const q = str(p.q).trim(); // legacy searched title/description

  const where = q
    ? { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] }
    : {};
  const [rows, total] = await Promise.all([
    db.adminNotification.findMany({
      where,
      orderBy: { id: "desc" },
      skip: start,
      take: limit,
    }),
    db.adminNotification.count({ where }),
  ]);
  return data(res, "Notifications retrieved", {
    notifications: rows.map((n) => ({
      id: n.id,
      title: n.title,
      description: n.description,
      created_at: n.createdAt.toISOString(),
    })),
    total_count: total,
  });
}));

// POST /community/admin/notifications/update {notification_id|notificationID, title, description}
// — updateNotification
router.post("/mobile-admin/notifications/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = notificationId(p);
  const title = str(p.title).trim();
  const description = str(p.description).trim();
  if (!id) return fail(res, "The notification id field is required.");
  if (!title) return fail(res, "The title field is required.");
  if (!description) return fail(res, "The description field is required.");

  const row = await db.adminNotification.findUnique({ where: { id: Number(id) } });
  if (!row) return fail(res, "Notification Not Found");
  await db.adminNotification.update({
    where: { id: row.id },
    data: { title, description },
  });
  return ok(res, "Notification Updated Successfully");
}));

// POST /community/admin/notifications/repeat {notification_id|notificationID} (or
// explicit title/description override) — repeatNotification: re-fan-out push.
router.post("/mobile-admin/notifications/repeat", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const id = notificationId(p);
  if (!id) return fail(res, "The notification id field is required.");

  const row = await db.adminNotification.findUnique({ where: { id: Number(id) } });
  if (!row) return fail(res, "Notification Not Found");

  // The legacy UI passed the row's title/description back in the request;
  // explicit params still win when provided.
  const title = str(p.title).trim() || row.title;
  const description = str(p.description).trim() || row.description;

  const recipients = await fanOutPush(title, description);
  feedEvent("notification.repeated", { id: row.id, title, recipients, by: s.userId });
  return ok(res, "Notification has been send again");
}));

// POST /community/admin/notifications/delete {notification_id|notificationID}
// — deleteNotification (hard delete, like legacy)
router.post("/mobile-admin/notifications/delete", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = notificationId(p);
  if (!id) return fail(res, "The notification id field is required.");

  const row = await db.adminNotification.findUnique({ where: { id: Number(id) } });
  if (!row) return fail(res, "Notification Not Found");
  await db.adminNotification.delete({ where: { id: row.id } });
  return ok(res, "Notification Delete Successfully");
}));

// ─── FAQs (FAQsController) ────────────────────────────────────────────────────

// GET /community/admin/faqs — fetchFAQs: FaqType where is_deleted=0 with nested
// faqs, newest first (legacy order on the faqs view).
router.get("/mobile-admin/faqs", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const types = await db.faqType.findMany({
    where: { isDeleted: 0 },
    orderBy: { id: "desc" },
    include: { faqs: { orderBy: { id: "desc" } } },
  });
  return data(res, "Fetching FAQs successfully", {
    faqs: types.map((t) => ({
      id: t.id,
      title: t.title,
      created_at: t.createdAt.toISOString(),
      faqs: t.faqs.map((f) => ({
        id: f.id,
        faqs_type_id: f.faqsTypeId,
        question: f.question,
        answer: f.answer,
        created_at: f.createdAt.toISOString(),
      })),
    })),
  });
}));

// POST /community/admin/faqs/types/add {title} — addFAQsType (duplicate title guard)
router.post("/mobile-admin/faqs/types/add", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const title = str(p.title).trim();
  if (!title) return fail(res, "The title field is required.");

  const dupe = await db.faqType.findFirst({ where: { title } });
  if (dupe) return fail(res, "FAQs Type Already Exist");

  const row = await db.faqType.create({ data: { title } });
  return data(res, "FAQs Type Added Successfully", {
    faq_type: { id: row.id, title: row.title },
  });
}));

// POST /community/admin/faqs/types/update {faqsType_id, title} — updateFAQsType
router.post("/mobile-admin/faqs/types/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = str(p.faqsType_id);
  const title = str(p.title).trim();
  if (!id) return fail(res, "The faqsType id field is required.");
  if (!title) return fail(res, "The title field is required.");

  const dupe = await db.faqType.findFirst({ where: { title } });
  if (dupe) return fail(res, "FAQs Type Record Dublicate");

  const row = await db.faqType.findUnique({ where: { id: Number(id) } });
  if (!row) return fail(res, "Support Subject Not Found");

  await db.faqType.update({ where: { id: row.id }, data: { title } });
  return ok(res, "FAQs Type Updated Successfully");
}));

// POST /community/admin/faqs/types/delete {faqsType_id} — deleteFAQsType.
// The legacy controller deletes every FAQ under the type and then the type
// itself (hard deletes) — ported as-is.
router.post("/mobile-admin/faqs/types/delete", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = str(p.faqsType_id);
  if (!id) return fail(res, "The faqsType id field is required.");

  const row = await db.faqType.findUnique({ where: { id: Number(id) } });
  if (!row) return fail(res, "FAQs Type Not Found");

  await db.faq.deleteMany({ where: { faqsTypeId: row.id } });
  await db.faqType.delete({ where: { id: row.id } });
  return ok(res, "FAQs Type Delete Successfully");
}));

// POST /community/admin/faqs/add {faqs_type_id, question, answer} — addFAQs
router.post("/mobile-admin/faqs/add", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const faqsTypeId = str(p.faqs_type_id);
  const question = str(p.question).trim();
  const answer = str(p.answer).trim();
  if (!faqsTypeId) return fail(res, "The faqs type id field is required.");
  if (!question) return fail(res, "The question field is required.");
  if (!answer) return fail(res, "The answer field is required.");

  const type = await db.faqType.findUnique({ where: { id: Number(faqsTypeId) } });
  if (!type) return fail(res, "FAQs Type Not Found");

  const row = await db.faq.create({
    data: { faqsTypeId: type.id, question, answer },
  });
  return data(res, "FAQs Added Successfully", {
    faq: { id: row.id, faqs_type_id: row.faqsTypeId, question: row.question, answer: row.answer },
  });
}));

// POST /community/admin/faqs/faqs/update {FAQs_id, faqs_type_id, question, answer}
// — updateFAQs (legacy param spelling FAQs_id kept)
router.post("/mobile-admin/faqs/faqs/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = str(p.FAQs_id) || str(p.faqs_id);
  const faqsTypeId = str(p.faqs_type_id);
  const question = str(p.question).trim();
  const answer = str(p.answer).trim();
  if (!id) return fail(res, "The FAQs id field is required.");
  if (!faqsTypeId) return fail(res, "The faqs type id field is required.");
  if (!question) return fail(res, "The question field is required.");
  if (!answer) return fail(res, "The answer field is required.");

  const row = await db.faq.findUnique({ where: { id: Number(id) } });
  if (!row) return fail(res, "Support Subject Not Found");
  const type = await db.faqType.findUnique({ where: { id: Number(faqsTypeId) } });
  if (!type) return fail(res, "FAQs Type Not Found");

  await db.faq.update({
    where: { id: row.id },
    data: { faqsTypeId: type.id, question, answer },
  });
  return ok(res, "FAQs Updated Successfully");
}));

// POST /community/admin/faqs/faqs/delete {faqs_id} — deleteFAQs (hard delete)
router.post("/mobile-admin/faqs/faqs/delete", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const id = str(p.faqs_id) || str(p.FAQs_id);
  if (!id) return fail(res, "The FAQs id field is required.");

  const row = await db.faq.findUnique({ where: { id: Number(id) } });
  if (!row) return fail(res, "Report Not Found"); // legacy wording
  await db.faq.delete({ where: { id: row.id } });
  return ok(res, "FAQs Delete Successfully");
}));

// ─── Dashboard chart (SettingsController::fetchAllChartData, adapted) ─────────

const CHART_DAYS = 14;

/** Per-table source: physical table + created-at column (users/donations keep
 *  Prisma's camelCase default; the community tables map to snake_case). */
const CHART_SOURCES: Array<{
  key: "users" | "posts" | "reels" | "rooms" | "donations";
  table: string;
  column: string;
  completedOnly?: boolean;
}> = [
  { key: "users", table: "users", column: "createdAt" },
  { key: "posts", table: "app_posts", column: "created_at" },
  { key: "reels", table: "app_reels", column: "created_at" },
  { key: "rooms", table: "app_rooms", column: "created_at" },
  { key: "donations", table: "donations", column: "createdAt", completedOnly: true },
];

/** UTC day bucket counts for one table over the trailing window. */
async function countsPerDay(
  table: string,
  column: string,
  completedOnly: boolean,
  start: Date,
  end: Date
): Promise<Map<string, number>> {
  const whereDonations = completedOnly ? Prisma.sql` AND "paymentStatus" = 'COMPLETED'` : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ d: Date; n: number }>>(
    Prisma.sql`
      SELECT date_trunc('day', ${Prisma.raw(`"${table}"."${column}"`)}) AS d, COUNT(*)::int AS n
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE ${Prisma.raw(`"${table}"."${column}"`)} >= ${start} AND ${Prisma.raw(`"${table}"."${column}"`)} < ${end}${whereDonations}
      GROUP BY 1`
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.d.toISOString().slice(0, 10), Number(r.n));
  return map;
}

// GET /community/admin/chart — per-day counts for the last 14 days
// { days: ["2026-11-12", ...], series: { users: [...], posts: [...], reels:
// [...], rooms: [...], donations: [...] } } (0-filled like the legacy chart).
router.get("/mobile-admin/chart", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1); // exclusive upper bound: tomorrow 00:00 UTC
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - CHART_DAYS); // 14 full days

  const days: string[] = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - 1 - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const [users, posts, reels, rooms, donations] = await Promise.all(
    CHART_SOURCES.map((s) => countsPerDay(s.table, s.column, !!s.completedOnly, start, end))
  );

  const fill = (m: Map<string, number>) => days.map((d) => m.get(d) ?? 0);
  return data(res, "Chart data", {
    days,
    series: {
      users: fill(users),
      posts: fill(posts),
      reels: fill(reels),
      rooms: fill(rooms),
      donations: fill(donations),
    },
  });
}));

// (const export above is the module surface — ../index.ts imports `router`).
