import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleError } from "@/lib/session";
import { logger } from "@/lib/logger";
import { requestLogger } from "@/lib/middleware/request-logger";
import { verifyEnv, allowedOrigins } from "@/config/env";
import { dashboardController } from "@/modules/dashboard";

// ─── Routers (1:1 conversions of src/app/api/**/route.ts) ───────────────────
import { router as authRouter } from "./routes/auth";
import { router as usersRouter } from "./routes/users";
import { router as profileRouter } from "./routes/profile";
import { router as notificationsRouter } from "./routes/notifications";
import { router as settingsRouter } from "./routes/settings";
import { router as activityLogsRouter } from "./routes/activity-logs";
import { router as statsRouter } from "./routes/stats";
import { router as filesRouter } from "./routes/files";
import { router as certificatesRouter } from "./routes/certificates";
import { router as testimonialsRouter } from "./routes/testimonials";
import { router as contactQueriesRouter } from "./routes/contact-queries";
import { router as donorsRouter } from "./routes/donors";
import { router as donationsRouter } from "./routes/donations";
import { router as paymentsRouter } from "./routes/payments";
import { router as receiptsRouter } from "./routes/receipts";
import { router as foodRouter } from "./routes/food";
import { router as mastersRouter } from "./routes/masters";
import { router as recurringNeedsRouter } from "./routes/recurring-needs";
import { router as beneficiaryRequestsRouter } from "./routes/beneficiary-requests";
import { router as healthOrgsRouter } from "./routes/health-orgs";
import { router as healthProfessionalsRouter } from "./routes/health-professionals";
import { router as healthAiRouter } from "./routes/health-ai";
import { router as healthTimelineRouter } from "./routes/health-timeline";
import { router as medicalCampsRouter } from "./routes/medical-camps";
import { router as appointmentsRouter } from "./routes/appointments";
import { router as beneficiariesRouter } from "./routes/beneficiaries";
import { router as encountersRouter } from "./routes/encounters";
import { router as prescriptionsRouter } from "./routes/prescriptions";
import { router as labOrdersRouter } from "./routes/lab-orders";
import { router as medicalDocumentsRouter } from "./routes/medical-documents";
import { router as screeningsRouter } from "./routes/screenings";
import { router as vitalsRouter } from "./routes/vitals";
import { router as followUpsRouter } from "./routes/follow-ups";
import { router as referralsRouter } from "./routes/referrals";
import { router as campAttendanceRouter } from "./routes/camp-attendance";
import { router as campExpensesRouter } from "./routes/camp-expenses";
import { router as campRegistrationsRouter } from "./routes/camp-registrations";
import { router as campPartnersRouter } from "./routes/camp-partners";
import { router as campStaffRouter } from "./routes/camp-staff";
import { router as campaignsRouter } from "./routes/campaigns";
import { router as campaignAnalyticsRouter } from "./routes/campaign-analytics";
import { router as causeAnalyticsRouter } from "./routes/cause-analytics";
import { router as causesRouter } from "./routes/causes";
import { router as pledgesRouter } from "./routes/pledges";
import { router as sponsorshipsRouter } from "./routes/sponsorships";
import { router as schoolCoveragesRouter } from "./routes/school-coverages";
import { router as reportsRouter } from "./routes/reports";
import { router as missionsRouter } from "./routes/missions";
import { router as inventoryRouter } from "./routes/inventory";
import { router as inventoryForecastRouter } from "./routes/inventory-forecast";
import { router as inventoryTransactionsRouter } from "./routes/inventory-transactions";
import { router as distributionsRouter } from "./routes/distributions";
import { router as kitBatchesRouter } from "./routes/kit-batches";
import { router as kitScanRouter } from "./routes/kit-scan";
import { router as kitStatsRouter } from "./routes/kit-stats";
import { router as kitTemplatesRouter } from "./routes/kit-templates";
import { router as kitUnitsRouter } from "./routes/kit-units";
import { router as padDistributionsRouter } from "./routes/pad-distributions";
import { router as animalsRouter } from "./routes/animals";
import { router as animalAnalyticsRouter } from "./routes/animal-analytics";
import { router as animalPledgesRouter } from "./routes/animal-pledges";
import { router as corridorEventsRouter } from "./routes/corridor-events";
import { router as corridorStatsRouter } from "./routes/corridor-stats";
import { router as ambulancesRouter } from "./routes/ambulances";
import { router as volunteersRouter } from "./routes/volunteers";
import { router as volunteerApplicationsRouter } from "./routes/volunteer-applications";
import { router as volunteerAssignmentsRouter } from "./routes/volunteer-assignments";
import { router as volunteerAttendancesRouter } from "./routes/volunteer-attendances";
import { router as volunteerTasksRouter } from "./routes/volunteer-tasks";
import { router as assistantRouter } from "./routes/assistant";
import { router as eventsRouter } from "./routes/events";

const app = express();
const PORT = Number(process.env.PORT || 4000);

// Boot-time environment check (skipped under NODE_ENV=test, which controls
// its own env). Throws with a readable message on misconfiguration.
verifyEnv();

// Wide-event request logging FIRST so every request (even ones that error
// during body parsing) emits exactly one structured log line on completion.
app.use(requestLogger);

// ─── Middleware ──────────────────────────────────────────────────────────────
const allowedOriginsList = allowedOrigins();

app.use(
  cors({
    origin(origin, cb) {
      // Allow non-browser tools (no Origin header) and any configured origin.
      if (!origin || allowedOriginsList.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);
app.use(
  express.json({
    limit: "10mb",
    // Stash the raw request body for webhook HMAC verification (e.g. the
    // Razorpay signature in /api/payments/webhook — re-serialized JSON is
    // only byte-identical for compact payloads).
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
// The mobile app's PusherChannelAuthorizer posts application/x-www-form-urlencoded
// to POST /api/realtime/auth (http package default for Map bodies) — parse both
// body styles. Harmless for the admin frontend, which always sends JSON.
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── Health + root dashboard stats (dashboard module) ────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "uar-backend" }));

app.get("/api", dashboardController.snapshot);

// ─── Mount all routers ───────────────────────────────────────────────────────
import { startPusherServer } from "@/lib/realtime/pusher";
import { syncPostCommentCounts } from "@/lib/community/counters";

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/profile", profileRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/activity-logs", activityLogsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/files", filesRouter);
app.use("/api/certificates", certificatesRouter);
app.use("/api/testimonials", testimonialsRouter);
app.use("/api/contact-queries", contactQueriesRouter);
app.use("/api/donors", donorsRouter);
app.use("/api/donations", donationsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/receipts", receiptsRouter);
app.use("/api/food", foodRouter);
app.use("/api/masters", mastersRouter);
app.use("/api/recurring-needs", recurringNeedsRouter);
app.use("/api/beneficiary-requests", beneficiaryRequestsRouter);
app.use("/api/health-orgs", healthOrgsRouter);
app.use("/api/health-professionals", healthProfessionalsRouter);
app.use("/api/health-ai", healthAiRouter);
app.use("/api/health-timeline", healthTimelineRouter);
app.use("/api/medical-camps", medicalCampsRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/beneficiaries", beneficiariesRouter);
app.use("/api/encounters", encountersRouter);
app.use("/api/prescriptions", prescriptionsRouter);
app.use("/api/lab-orders", labOrdersRouter);
app.use("/api/medical-documents", medicalDocumentsRouter);
app.use("/api/screenings", screeningsRouter);
app.use("/api/vitals", vitalsRouter);
app.use("/api/follow-ups", followUpsRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/camp-attendance", campAttendanceRouter);
app.use("/api/camp-expenses", campExpensesRouter);
app.use("/api/camp-registrations", campRegistrationsRouter);
app.use("/api/camp-partners", campPartnersRouter);
app.use("/api/camp-staff", campStaffRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/campaign-analytics", campaignAnalyticsRouter);
app.use("/api/cause-analytics", causeAnalyticsRouter);
app.use("/api/causes", causesRouter);
app.use("/api/pledges", pledgesRouter);
app.use("/api/sponsorships", sponsorshipsRouter);
app.use("/api/school-coverages", schoolCoveragesRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/missions", missionsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/inventory-forecast", inventoryForecastRouter);
app.use("/api/inventory-transactions", inventoryTransactionsRouter);
app.use("/api/distributions", distributionsRouter);
app.use("/api/kit-batches", kitBatchesRouter);
app.use("/api/kit-scan", kitScanRouter);
app.use("/api/kit-stats", kitStatsRouter);
app.use("/api/kit-templates", kitTemplatesRouter);
app.use("/api/kit-units", kitUnitsRouter);
app.use("/api/pad-distributions", padDistributionsRouter);
app.use("/api/animals", animalsRouter);
app.use("/api/animal-analytics", animalAnalyticsRouter);
app.use("/api/animal-pledges", animalPledgesRouter);
app.use("/api/corridor-events", corridorEventsRouter);
app.use("/api/corridor-stats", corridorStatsRouter);
app.use("/api/ambulances", ambulancesRouter);
app.use("/api/volunteers", volunteersRouter);
app.use("/api/volunteer-applications", volunteerApplicationsRouter);
app.use("/api/volunteer-assignments", volunteerAssignmentsRouter);
app.use("/api/volunteer-attendances", volunteerAttendancesRouter);
app.use("/api/volunteer-tasks", volunteerTasksRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/events", eventsRouter);

// ─── Generic community routers (shared by web + mobile) ─────────────────────
// S6 — charity domain: charity card / points / achievements / goals / events
// + the community admin surface, migrated off the mobile-only compat layer.
import { router as charityRouter } from "./routes/charity";
import { router as communityAdminRouter } from "./routes/community-admin";
app.use("/api/charity", charityRouter);
app.use("/api/community/admin", communityAdminRouter);

// S1 — auth-users/profile/notifications/config: social users, app settings,
// FAQs (the auth/profile/notifications routers themselves were extended in place).
import { router as communityUsersRouter } from "./routes/community-users";
import { router as faqsRouter } from "./routes/faqs";
app.use("/api/community/users", communityUsersRouter);
app.use("/api/faqs", faqsRouter);

// S2 — posts/stories/interests: feeds, post CRUD (owner-or-moderator delete),
// reactions, comments (author-or-moderator delete), 24h stories and the
// interest list, migrated off the mobile-only compat layer.
import { router as communityPostsRouter } from "./routes/posts";
import { router as communityStoriesRouter } from "./routes/stories";
import { router as communityInterestsRouter } from "./routes/interests";
app.use("/api/posts", communityPostsRouter);
app.use("/api/stories", communityStoriesRouter);
app.use("/api/interests", communityInterestsRouter);

// S4 — rooms: /api/rooms (create/edit/delete, join/leave, invitations, join
// requests, members/admins, mute, suggested/random/by-interest), migrated off
// the mobile-only compat layer.
import { router as communityRoomsRouter } from "./routes/rooms";
app.use("/api/rooms", communityRoomsRouter);

// S5 — realtime + chat + audio spaces: Pusher channel auth, Agora tokens,
// conversations/messages and Agora voice rooms (shared by web + mobile — the
// Flutter app's websocket client authorizes private channels here too).
import { router as realtimeRouter } from "./routes/realtime";
import { router as chatRouter } from "./routes/chat";
import { router as audioSpacesRouter } from "./routes/audio-spaces";
app.use("/api/realtime", realtimeRouter);
app.use("/api/chat", chatRouter);
app.use("/api/audio-spaces", audioSpacesRouter);

// S3 — reels + music: reel feeds, reel CRUD (owner-or-moderator delete), likes,
// views, comments (author/reel-owner/moderator delete), reports and the reel
// music library, migrated off the mobile-only compat layer.
import { router as reelsRouter } from "./routes/reels";
import { router as musicRouter } from "./routes/music";
app.use("/api/reels", reelsRouter);
app.use("/api/music", musicRouter);

// Presigned direct video uploads + the transcoder polling/playback API.
import { router as mediaRouter } from "./routes/media";
app.use("/api/media", mediaRouter);

// ─── 404 + error handling ────────────────────────────────────────────────────
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Stash for the request wide-event, then log the full stack once.
  (res.locals as Record<string, unknown>).error = err;
  logger.error("unhandled_error", {
    request_id: req.requestId,
    method: req.method,
    path: req.originalUrl,
    error: err,
  });
  try {
    handleError(err, res);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  logger.info("server_started", {
    port: PORT,
    env: process.env.NODE_ENV || "development",
    log_level: process.env.LOG_LEVEL || "info",
  });
});

syncPostCommentCounts().catch((e) =>
  logger.error("comment_count_sync_failed", { error: e instanceof Error ? e : String(e) })
);

// Background video transcoder (DB-backed queue — see lib/media/transcoder.ts).
// No-ops when TRANSCODER_ENABLED === "false" or under NODE_ENV=test.
import { startTranscoder } from "@/lib/media/transcoder";
import { assertStorageConfig } from "@/lib/storage";

// Crash boot on a misconfigured storage driver (names the missing variables).
assertStorageConfig();

try {
  startTranscoder();
} catch (e) {
  logger.error("transcoder_start_failed", { error: e instanceof Error ? e : String(e) });
}

// Pusher-protocol WebSocket server for the mobile app (Laravel Reverb wire
// format, ws://host:6001/app/chatter-key). Starts after the HTTP listener.
try {
  startPusherServer();
} catch (e) {
  logger.error("pusher_server_start_failed", { error: e instanceof Error ? e : String(e) });
}
