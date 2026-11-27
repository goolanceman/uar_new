/**
 * Common reusable Zod schemas — pagination, identifiers, and the
 * Indian-format field rules that route-level validation previously
 * hand-rolled. `pageQuerySchema` mirrors `pageParams()` exactly (defaults
 * page=1/limit=20, hard cap 100) so refactored routes keep identical
 * pagination behavior.
 */
import { z } from "zod";

/** Positive integer id used by most SQL-backed tables. */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const stringIdParamSchema = z.object({
  id: z.string().min(1),
});

/**
 * Pagination query — matches legacy pageParams(): page floors at 1, limit
 * floors at 1 and caps at `maxLimit` (default 20, max 100).
 */
export const pageQuerySchema = (defLimit = 20, maxLimit = 100) =>
  z.object({
    page: z.coerce.number().int().min(1).catch(1).default(1),
    limit: z.coerce.number().int().min(1).catch(defLimit).transform((n) => Math.min(maxLimit, n)),
  });

/** Returns {page, limit, skip} exactly like the legacy helper. */
export function pageParamsFrom(q: { page: number; limit: number }): { page: number; limit: number; skip: number } {
  return { page: q.page, limit: q.limit, skip: (q.page - 1) * q.limit };
}

// ─── Indian-format field rules (kept in sync with lib/validators.ts) ────────

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const PHONE_REGEX = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
export const PIN_REGEX = /^[1-9][0-9]{5}$/;
export const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
export const UPI_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(PAN_REGEX, "PAN must look like ABCDE1234F"));

export const phoneSchema = z
  .string()
  .transform((v) => v.replace(/[\s\-+]/g, "").replace(/^91(?=\d{10}$)/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"));

export const emailSchema = z.string().trim().toLowerCase().regex(EMAIL_REGEX, "Enter a valid email address");

export const pinSchema = z.string().trim().regex(PIN_REGEX, "PIN code must be 6 digits (e.g. 560001)");

export const upiSchema = z.string().trim().regex(UPI_REGEX, "Enter a valid UPI ID");

/** Non-empty trimmed string (the workhorse for most text fields). */
export const requiredString = (label: string) =>
  z.string({ error: `The ${label} field is required.` }).trim().min(1, `The ${label} field is required.`);

/** Optional string that becomes null when absent/empty. */
export const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
