/**
 * Food module schemas — /api/food request definitions.
 *
 * The legacy handlers read `(req.body ?? {})` and coerced/validated fields
 * mid-handler AFTER the auth gate and the first entity lookup (404-before-400
 * ordering — e.g. the food event lookup precedes every body check on the
 * allocation/registration/walk-in routes), so every body schema is a
 * permissive envelope: the exact field coercions, orderings and error
 * messages live in the services. Nothing the legacy accepted is rejected here.
 *
 * Queries were parsed with URLSearchParams over the raw URL (`sp.get(...)`
 * with trim/toUpperCase/coercion chains), so controllers pass the
 * searchParams through to the services instead of Zod-reparsing req.query —
 * identical repeated-key and percent-encoding semantics. Path params use the
 * extraction-only shared id schema (the services render the 404s).
 */
import { z } from "zod";

/** Permissive body envelope — legacy mid-handler validation (see file note). */
const looseBody = z.any();

// ─── Allocations (stock desk) ────────────────────────────────────────────────

export const allocationCreateBodySchema = looseBody;
export const allocationActionBodySchema = looseBody;
export type FoodBody = Record<string, unknown>;

// ─── Applications (public + review) ──────────────────────────────────────────

export const applicationCreateBodySchema = looseBody;
export const applicationReviewBodySchema = looseBody;

// ─── Batches (goods receipt + quality inspection) ────────────────────────────

export const batchCreateBodySchema = looseBody;
export const batchInspectBodySchema = looseBody;

// ─── Distribution desk (checkin) ─────────────────────────────────────────────

export const checkinBodySchema = looseBody;

// ─── Events + expenses ───────────────────────────────────────────────────────

export const eventCreateBodySchema = looseBody;
export const eventUpdateBodySchema = looseBody;
export const expenseCreateBodySchema = looseBody;

// ─── Event registrations + walk-in + queue update ────────────────────────────

export const eventRegistrationBodySchema = looseBody;
export const walkinBodySchema = looseBody;
export const registrationUpdateBodySchema = looseBody;

// ─── Event volunteers ────────────────────────────────────────────────────────

export const volunteerAssignBodySchema = looseBody;

// ─── Households ──────────────────────────────────────────────────────────────

export const householdCreateBodySchema = looseBody;
export const householdUpdateBodySchema = looseBody;

// ─── Insights (AI) ───────────────────────────────────────────────────────────

export const insightBodySchema = looseBody;

// ─── Pledges ─────────────────────────────────────────────────────────────────

export const pledgeCreateBodySchema = looseBody;
export const pledgeActionBodySchema = looseBody;

// ─── Programmes ──────────────────────────────────────────────────────────────

export const programmeCreateBodySchema = looseBody;
export const programmeUpdateBodySchema = looseBody;
