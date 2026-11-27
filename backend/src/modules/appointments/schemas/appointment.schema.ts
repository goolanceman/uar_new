/**
 * Appointment schemas — request definitions for /api/appointments*.
 *
 * The legacy handlers read query values with parseInt() coercions and the
 * body field-by-field interleaved with DB lookups (404-before-400 ordering),
 * so every field check stays in the service: the query schema reproduces the
 * pageParams() coercion expressions verbatim and the body schema is a
 * permissive envelope (no invented rejections).
 */
import { z } from "zod";

// ─── GET /api/appointments?campId&beneficiaryId&professionalId&type&status&from&to ──

/** Legacy: sp.get(x) || undefined — absent/blank means "no filter". */
const queryFilter = z
  .any()
  .optional()
  .transform((v) => (typeof v === "string" && v ? v : undefined));

/** Legacy pageParams(): Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1)
 *  — parseInt semantics ("2abc" parses as 2), NaN/absent fall back. */
const legacyPage = z
  .any()
  .optional()
  .transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1));

/** Legacy pageParams(): Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "24", 10) || 24)). */
const legacyLimit = z
  .any()
  .optional()
  .transform((v) => Math.min(200, Math.max(1, parseInt(String(v ?? "24"), 10) || 24)));

export const listAppointmentsQuerySchema = z.object({
  campId: queryFilter,
  beneficiaryId: queryFilter,
  professionalId: queryFilter,
  type: queryFilter,
  status: queryFilter,
  from: queryFilter,
  to: queryFilter,
  page: legacyPage,
  limit: legacyLimit,
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

// ─── POST/PATCH bodies (checks interleaved with lookups — see service) ───────

/** Permissive body envelope: the legacy handlers validated every field
 *  mid-flow between DB lookups, so the exact 400/404/409 messages and their
 *  ordering are preserved in the service. */
export const appointmentBodySchema = z.any();
export type AppointmentBody = Record<string, unknown>;

// ─── Params (cuid ids — Express only matches non-empty) ──────────────────────

export const appointmentIdParamSchema = z.object({
  id: z.string().min(1),
});
export type AppointmentIdParams = z.infer<typeof appointmentIdParamSchema>;
