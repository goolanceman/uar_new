/**
 * Contact query schemas — Zod definitions for every /api/contact-queries
 * request. Validation messages match the legacy route errors exactly (the
 * combined presence message, the same email regex + message, uppercased
 * status enum).
 */
import { z } from "zod";

// ─── GET /api/contact-queries ────────────────────────────────────────────────

/** ?status — optional filter; absent/empty means "no filter" (legacy `if (status)`). */
export const listContactQueriesQuerySchema = z.object({
  status: z.preprocess((v) => {
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s ? s : undefined;
  }, z.string().optional()),
});
export type ListContactQueriesQuery = z.infer<typeof listContactQueriesQuerySchema>;

// ─── POST /api/contact-queries (public) ─────────────────────────────────────

export const createContactQuerySchema = z.object({
  name: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().min(1, "Name, email, subject and message are required")
  ),
  /** Legacy: String(...).trim().toLowerCase(); regex runs only on a non-empty value. */
  email: z.preprocess(
    (v) => String(v ?? "").trim().toLowerCase(),
    z
      .string()
      .min(1, "Name, email, subject and message are required")
      .pipe(z.string().regex(/^\S+@\S+\.\S+$/, "Please enter a valid email address"))
  ),
  subject: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().min(1, "Name, email, subject and message are required")
  ),
  message: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().min(1, "Name, email, subject and message are required")
  ),
  phone: z.preprocess((v) => (v ? String(v).trim() : null), z.string().nullable()),
});
export type CreateContactQueryBody = z.infer<typeof createContactQuerySchema>;

// ─── PATCH /api/contact-queries/:id ─────────────────────────────────────────

export const updateContactQuerySchema = z.object({
  status: z.preprocess(
    (v) => String(v ?? "").trim().toUpperCase(),
    z.enum(["PENDING", "RESOLVED", "CLOSED"], {
      error: "Status must be RESOLVED, CLOSED or PENDING",
    })
  ),
});
export type UpdateContactQueryBody = z.infer<typeof updateContactQuerySchema>;
