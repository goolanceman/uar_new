import "dotenv/config";
import express from "express";
import cors from "cors";
import { db } from "@/lib/db";
import { handleError } from "@/lib/session";

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

// ─── Middleware ──────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Allow non-browser tools (no Origin header) and any configured origin.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
// The mobile app's NewApiService posts application/x-www-form-urlencoded
// (http package default for Map bodies) — parse both body styles. Harmless
// for the admin frontend, which always sends JSON.
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── Health + root dashboard stats (converted from src/app/api/route.ts) ────
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "uar-backend" }));

app.get("/api", async (_req, res) => {
  try {
    const totalDonations = await db.donation.aggregate({
      _sum: { amount: true },
      where: { paymentStatus: "COMPLETED" },
    });

    const beneficiariesCount = await db.beneficiary.count({
      where: { isActive: true },
    });

    const activeCampaigns = await db.campaign.count({
      where: { status: "ACTIVE" },
    });

    const volunteersCount = await db.volunteer.count({
      where: { status: "ACTIVE" },
    });

    const inventoryItems = await db.inventoryItem.aggregate({
      _sum: { quantity: true },
    });

    return res.json({
      success: true,
      data: {
        totalDonations: totalDonations._sum.amount || 0,
        beneficiaries: beneficiariesCount,
        activeCampaigns,
        volunteers: volunteersCount,
        inventoryItems: inventoryItems._sum.quantity || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch dashboard stats" });
  }
});

// ─── Mount all routers ───────────────────────────────────────────────────────
// ─── Mobile wire-compat layer (Flutter app) ──────────────────────────────────
// Mounted BEFORE the routers below: claims only requests carrying the mobile
// `apikey` header and serves the legacy {status, message, data} envelope;
// everything else falls through to the admin routers untouched.
import { router as mobileCompatRouter, broadcastingAuthHandler } from "./routes/mobile";
import { startPusherServer } from "@/lib/mobile/pusher";
import { syncPostCommentCounts } from "@/lib/mobile/compat";
app.use("/api", (req, res, next) => {
  // The gate must live OUTSIDE the compat router: from a router-level
  // middleware, next() reaches the compat routes themselves, which would claim
  // colliding paths (/api/auth/*, /api/notifications/*, ...) even without an
  // apikey and shadow the admin/web routers. Entering the compat router only
  // for apikey requests keeps /api/auth/login etc. working for both clients —
  // e.g. the Flutter portal (Bearer token, no apikey) gets the web envelope.
  if (!req.header("apikey")) return next();
  return mobileCompatRouter(req, res, next);
});
app.post("/broadcasting/auth", broadcastingAuthHandler);

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

// ─── 404 + error handling ────────────────────────────────────────────────────
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[backend]", err);
  try {
    handleError(err, res);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`[uar-backend] listening on http://localhost:${PORT}`);
});

syncPostCommentCounts().catch((e) => console.error("[mobile] comment count sync failed", e));

// Pusher-protocol WebSocket server for the mobile app (Laravel Reverb wire
// format, ws://host:6001/app/chatter-key). Starts after the HTTP listener.
try {
  startPusherServer();
} catch (e) {
  console.error("[mobile] pusher server failed to start", e);
}
