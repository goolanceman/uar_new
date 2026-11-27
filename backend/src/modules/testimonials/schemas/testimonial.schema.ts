/**
 * Testimonial schemas — Zod definitions for every /api/testimonials request.
 * Validation semantics (coercions, clamps, messages) match the legacy route
 * exactly so existing clients see identical responses.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** Testimonial ids are cuid strings — `:id` segments are never empty. */
export const testimonialIdParamSchema = stringIdParamSchema;
export type TestimonialIdParams = z.infer<typeof testimonialIdParamSchema>;

// ─── POST /api/testimonials ─────────────────────────────────────────────────
// Legacy: String(body?.x ?? "").trim() with a single combined required
// message, and a rating that defaults to 5, falls back to 5 when NaN, and is
// clamped to 1..5 after rounding. Unknown body keys were ignored.
const legacyText = z
  .unknown()
  .optional()
  .transform((v) => String(v ?? "").trim())
  .pipe(z.string().min(1, "Name, role and message are required"));

const legacyRating = z.unknown().optional().transform((v) => {
  let rating = v !== undefined ? Number(v) : 5;
  if (!Number.isFinite(rating)) rating = 5;
  return Math.min(5, Math.max(1, Math.round(rating)));
});

export const createTestimonialSchema = z.object({
  name: legacyText,
  role: legacyText,
  message: legacyText,
  rating: legacyRating,
});
export type CreateTestimonialBody = z.infer<typeof createTestimonialSchema>;

// ─── PATCH /api/testimonials/:id ────────────────────────────────────────────
// Legacy validated body fields AFTER the testimonial existence lookup (a
// missing testimonial returned 404 before any body check, and an empty patch
// yielded 400 "Nothing to update"), so per-field coercion is enforced in the
// service. This schema intentionally accepts anything — no new rejections.
export const updateTestimonialBodySchema = z.any();
export type UpdateTestimonialBody = Record<string, unknown>;
