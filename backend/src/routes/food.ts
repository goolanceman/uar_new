/**
 * Food routes — /api/food/*
 * Thin endpoint definitions; all logic lives in src/modules/food
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/food`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * NOTE: "/applications/status" is declared BEFORE "/applications/:id" so the
 * literal path is never captured as an id. The listing branches with
 * query-dependent auth (?public=1/?mine=1 on events/programmes/pledges,
 * ?available=1 on event volunteers) keep their branch-dependent requireRole
 * gates inside the controllers, in legacy order. Rate-limited public
 * endpoints run the limiter as their FIRST middleware — before body
 * validation and any session probe, exactly like the legacy handlers.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  allocationActionBodySchema,
  allocationCreateBodySchema,
  applicationCreateBodySchema,
  applicationReviewBodySchema,
  batchCreateBodySchema,
  batchInspectBodySchema,
  checkinBodySchema,
  eventCreateBodySchema,
  eventRegistrationBodySchema,
  eventUpdateBodySchema,
  expenseCreateBodySchema,
  householdCreateBodySchema,
  householdUpdateBodySchema,
  insightBodySchema,
  pledgeActionBodySchema,
  pledgeCreateBodySchema,
  programmeCreateBodySchema,
  programmeUpdateBodySchema,
  registrationUpdateBodySchema,
  volunteerAssignBodySchema,
  walkinBodySchema,
} from "@/modules/food/schemas/food.schema";
import {
  allocationController,
  applicationController,
  batchController,
  checkinController,
  eventController,
  eventVolunteerController,
  foodRateLimit,
  householdController,
  insightController,
  pledgeController,
  programmeController,
  publicStatsController,
  registrationController,
} from "@/modules/food";

export const router = Router();

/**
 * POST /api/food/allocations — ADMIN reserves stock for an event.
 * Each line is reserved FEFO across inspected batches inside one transaction;
 * a shortfall aborts the whole reservation (no partial events).
 */
router.post(
  "/allocations",
  authorize("ADMIN"),
  validate({ body: allocationCreateBodySchema }),
  allocationController.reserve
);

// PATCH /api/food/allocations/:id — ADMIN { action: "issue" | "cancel" }
router.patch(
  "/allocations/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: allocationActionBodySchema }),
  allocationController.decide
);

// GET /api/food/applications — ADMIN review queue (all food assistance requests)
router.get("/applications", authorize("ADMIN", "VOLUNTEER"), applicationController.list);

// POST /api/food/applications — PUBLIC food assistance application.
// Rate-limited, duplicate-checked, consent required (the limiter runs as the
// first middleware, before body validation — legacy order).
router.post(
  "/applications",
  foodRateLimit("applications", "food.applications.rateLimitPerHour"),
  validate({ body: applicationCreateBodySchema }),
  applicationController.submit
);

// GET /api/food/applications/status — public status check, rate-limited.
// (Declared before /applications/:id so the literal path is never captured.)
router.get(
  "/applications/status",
  foodRateLimit("status", "food.statusCheck.rateLimitPerHour"),
  applicationController.statusCheck
);

// PATCH /api/food/applications/:id — ADMIN review workflow.
router.patch(
  "/applications/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: applicationReviewBodySchema }),
  applicationController.review
);

// GET /api/food/batches?itemId&q&expiring=days&quality — ADMIN stock desk
router.get("/batches", authorize("ADMIN", "VOLUNTEER"), batchController.list);

// POST /api/food/batches — ADMIN goods receipt (traceable batch + master stock).
router.post("/batches", authorize("ADMIN"), validate({ body: batchCreateBodySchema }), batchController.receive);

// PATCH /api/food/batches/:id — ADMIN quality inspection & stock control.
router.patch(
  "/batches/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: batchInspectBodySchema }),
  batchController.inspect
);

/**
 * POST /api/food/checkin — the distribution desk endpoint.
 * action=lookup (check-in) / action=checkout (handover). Roles: ADMIN
 * anywhere; VOLUNTEER only on events they hold a FOOD_EVENT task for
 * (enforced in the service, after resolution/disambiguation — legacy order).
 */
router.post("/checkin", authorize("ADMIN", "VOLUNTEER"), validate({ body: checkinBodySchema }), checkinController.handle);

// GET /api/food/events            — ADMIN list w/ filters
// GET /api/food/events?public=1   — public list (safe fields only)
// GET /api/food/events?mine=1     — BENEFICIARY: own registrations
// (Auth is branch-dependent — the controller gates with requireRole after
// the public branch, in legacy order.)
router.get("/events", eventController.list);

// POST /api/food/events — ADMIN create
router.post("/events", authorize("ADMIN"), validate({ body: eventCreateBodySchema }), eventController.create);

// GET /api/food/events/:id — ADMIN event detail: lifecycle, requirements vs
// stock, allocations, registration counts, expenses.
router.get("/events/:id", authorize("ADMIN"), validate({ params: stringIdParamSchema }), eventController.detail);

// PATCH /api/food/events/:id — ADMIN lifecycle transitions + field edits.
router.patch(
  "/events/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: eventUpdateBodySchema }),
  eventController.update
);

// GET /api/food/events/:id/expenses — ADMIN/VOLUNTEER
router.get("/events/:id/expenses", authorize("ADMIN", "VOLUNTEER"), validate({ params: stringIdParamSchema }), eventController.listExpenses);

// POST /api/food/events/:id/expenses — ADMIN record programme spend
router.post(
  "/events/:id/expenses",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: expenseCreateBodySchema }),
  eventController.createExpense
);

// GET /api/food/events/:id/registrations — ADMIN/VOLUNTEER registration list
router.get("/events/:id/registrations", authorize("ADMIN", "VOLUNTEER"), validate({ params: stringIdParamSchema }), registrationController.listForEvent);

// POST /api/food/events/:id/registrations
//   ADMIN: { beneficiaryIds: string[] } bulk, or { beneficiaryId, unitsAllocated?, householdId?, notes? }
//   BENEFICIARY: {} (self-registration on their own record)
// (Legacy gate: validateSession + manual 401 — exactly the authenticate
// middleware; role branching happens in the service.)
router.post(
  "/events/:id/registrations",
  authenticate,
  validate({ params: stringIdParamSchema, body: eventRegistrationBodySchema }),
  registrationController.createForEvent
);

// GET /api/food/events/:id/volunteers              (ADMIN | VOLUNTEER)
// GET /api/food/events/:id/volunteers?available=1  (ADMIN)
// (Auth is branch-dependent — the controller gates with requireRole after
// the available branch, in legacy order.)
router.get("/events/:id/volunteers", validate({ params: stringIdParamSchema }), eventVolunteerController.list);

// POST /api/food/events/:id/volunteers (ADMIN) — { volunteerId, role, notes? }
router.post(
  "/events/:id/volunteers",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: volunteerAssignBodySchema }),
  eventVolunteerController.assign
);

// DELETE /api/food/events/:id/volunteers?taskId= (ADMIN) — soft-cancel the
// assignment (the taskId guard keeps its exact 400 in the controller).
router.delete(
  "/events/:id/volunteers",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema }),
  eventVolunteerController.unassign
);

/**
 * POST /api/food/events/:id/walkin — emergency walk-in at the distribution
 * desk. Creates the beneficiary identity AND the registration in one
 * transaction. Roles: ADMIN anywhere; VOLUNTEER only on assigned events
 * (enforced in the service — legacy order).
 */
router.post(
  "/events/:id/walkin",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: stringIdParamSchema, body: walkinBodySchema }),
  registrationController.walkin
);

// GET /api/food/households?q — ADMIN household registry
router.get("/households", authorize("ADMIN", "VOLUNTEER"), householdController.list);

// POST /api/food/households — ADMIN create household + members
router.post("/households", authorize("ADMIN"), validate({ body: householdCreateBodySchema }), householdController.create);

// PATCH /api/food/households/:id — ADMIN edit / add / remove members
router.patch(
  "/households/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: householdUpdateBodySchema }),
  householdController.update
);

// DELETE /api/food/households/:id — ADMIN (only when no registrations exist)
router.delete("/households/:id", authorize("ADMIN"), validate({ params: stringIdParamSchema }), householdController.remove);

/**
 * POST /api/food/insights { mode, eventId?, question? } — AI Food Security
 * insights, ADMIN-only, advisory-only (503 when the AI provider is down —
 * the legacy two-step catch lives in the controller).
 */
router.post("/insights", authorize("ADMIN"), validate({ body: insightBodySchema }), insightController.generate);

// GET /api/food/pledges           — ADMIN pickups desk
// GET /api/food/pledges?mine=1    — signed-in donor's own pledges
// (Auth is branch-dependent — the controller gates after the mine branch.)
router.get("/pledges", pledgeController.list);

// POST /api/food/pledges — PUBLIC food/grocery donation pledge with pickup
// (the limiter runs as the first middleware, before body validation —
// legacy order; the session probe stays in the controller).
router.post(
  "/pledges",
  foodRateLimit("pledges", "food.pledges.rateLimitPerHour"),
  validate({ body: pledgeCreateBodySchema }),
  pledgeController.create
);

// PATCH /api/food/pledges/:id — the pickups desk workflow
// (schedule → collect → receive → reject/cancel).
router.patch(
  "/pledges/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: pledgeActionBodySchema }),
  pledgeController.decide
);

// GET /api/food/programmes            — admin list (all statuses)
// GET /api/food/programmes?public=1   — public list (safe fields)
// (Auth is branch-dependent — the controller gates after the public branch.)
router.get("/programmes", programmeController.list);

// POST /api/food/programmes — ADMIN create
router.post("/programmes", authorize("ADMIN"), validate({ body: programmeCreateBodySchema }), programmeController.create);

// GET /api/food/programmes/:id — ADMIN programme detail with event rollups
router.get("/programmes/:id", authorize("ADMIN"), validate({ params: stringIdParamSchema }), programmeController.detail);

// PATCH /api/food/programmes/:id — ADMIN edit / lifecycle
router.patch(
  "/programmes/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: programmeUpdateBodySchema }),
  programmeController.update
);

/**
 * GET /api/food/public — public, privacy-safe food security aggregate.
 * Every figure is computed from real platform data at request time.
 */
router.get("/public", publicStatsController.stats);

// GET /api/food/registrations?eventId&status&q — ADMIN/VOLUNTEER queue lookup.
router.get("/registrations", authorize("ADMIN", "VOLUNTEER"), registrationController.list);

// PATCH /api/food/registrations/:id — ADMIN lifecycle (approve/reject/cancel/
// no-show/reschedule/confirm). Handover itself happens via /api/food/checkin.
router.patch(
  "/registrations/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: registrationUpdateBodySchema }),
  registrationController.update
);
