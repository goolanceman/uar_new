/**
 * Donation schemas — /api/donations input.
 *
 * Every donations endpoint validated its input mid-handler with hand-rolled
 * checks and bespoke error messages, frequently interleaved with DB lookups
 * (the recurring-parent/pledge 400s and 403s run BETWEEN body checks; the
 * admin PATCH validates each field against constants with per-field
 * messages), so — like the payments module — the body schemas are permissive
 * whole-body envelopes and the exact legacy checks live in the service in
 * the exact legacy order. Do not add Zod-level rejections here: the legacy
 * endpoints accepted anything express.json() parsed.
 */
import { z } from "zod";

/** POST /api/donations — guest or session donation creation. Legacy read
 *  `req.body ?? {}` and hand-validated amount/campaign/donor/phone/PAN/
 *  recurring fields in-handler (the campaign and food-event 400 checks run
 *  BEFORE the donor-name/email checks). */
export const createDonationBodySchema = z.any();
export type CreateDonationBody = Record<string, unknown>;

/** PATCH /api/donations/recurring/:id — legacy hand-validated recurringStatus
 *  (workflow transition), amount and recurringFrequency per-field, then
 *  "Nothing to update" when the patch is empty. */
export const updateRecurringBodySchema = z.any();
export type UpdateRecurringBody = Record<string, unknown>;

/** PATCH /api/donations/:id — admin whitelist edit; per-field enum/PAN/fees/
 *  refund checks with exact legacy messages run in the service. */
export const updateDonationBodySchema = z.any();
export type UpdateDonationBody = Record<string, unknown>;
