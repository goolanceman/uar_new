/**
 * Kit template schemas — Zod definitions for every /api/kit-templates request.
 * Validation messages and coercions match the legacy route exactly
 * (String(...).trim() presence, uppercased kind/status enums, Number(v)||0
 * cost coercion, items non-empty arrays).
 */
import { z } from "zod";

const KIT_KINDS = [
  "RATION",
  "FOOD",
  "EDUCATION",
  "MEDICAL",
  "HYGIENE",
  "CLOTHING",
  "EMERGENCY",
  "CUSTOM",
] as const;

// ─── POST /api/kit-templates ─────────────────────────────────────────────────

export const createKitTemplateSchema = z.object({
  name: z.preprocess((v) => String(v ?? "").trim(), z.string().min(1, "name is required")),
  items: z
    .array(z.unknown(), { error: "items must be a non-empty array" })
    .min(1, "items must be a non-empty array"),
  /** Legacy Number(body.costPerUnit ?? 0) || 0 — junk values silently become 0. */
  costPerUnit: z.preprocess((v) => Number(v ?? 0) || 0, z.number()),
  kind: z.preprocess(
    (v) => (v ? String(v).toUpperCase() : "RATION"),
    z.enum(KIT_KINDS, { error: "Invalid kit kind" })
  ),
  codePrefix: z.preprocess(
    (v) => (v ? String(v).trim().toUpperCase() : null),
    z.string().nullable()
  ),
  description: z.preprocess((v) => (v ? String(v) : null), z.string().nullable()),
  image: z.preprocess((v) => (v ? String(v).trim() : null), z.string().nullable()),
  /** Legacy: body.status === "RETIRED" ? "RETIRED" : "ACTIVE" — anything else is ACTIVE. */
  status: z.preprocess((v) => (v === "RETIRED" ? "RETIRED" : "ACTIVE"), z.enum(["ACTIVE", "RETIRED"])),
});
export type CreateKitTemplateBody = z.infer<typeof createKitTemplateSchema>;

// ─── PATCH /api/kit-templates/:id ────────────────────────────────────────────

/** All fields optional; only present keys are applied (service preserves the
 *  legacy data-object key order for the structured log). */
export const updateKitTemplateSchema = z.object({
  name: z.preprocess(
    (v) => (v === undefined ? undefined : String(v).trim()),
    z.string().optional()
  ),
  kind: z.preprocess(
    (v) => (v === undefined ? undefined : String(v).toUpperCase()),
    z.enum(KIT_KINDS, { error: "Invalid kit kind" }).optional()
  ),
  codePrefix: z.preprocess(
    (v) => (v === undefined ? undefined : v ? String(v).trim().toUpperCase() : null),
    z.string().nullable().optional()
  ),
  image: z.preprocess(
    (v) => (v === undefined ? undefined : v ? String(v).trim() : null),
    z.string().nullable().optional()
  ),
  status: z.preprocess(
    (v) => (v === undefined ? undefined : String(v).toUpperCase()),
    z.enum(["ACTIVE", "RETIRED"], { error: "Invalid status" }).optional()
  ),
  description: z.preprocess(
    (v) => (v === undefined ? undefined : v ? String(v) : null),
    z.string().nullable().optional()
  ),
  items: z.preprocess(
    (v) => (v === undefined ? undefined : v),
    z
      .array(z.unknown(), { error: "items must be a non-empty array" })
      .min(1, "items must be a non-empty array")
      .optional()
  ),
  costPerUnit: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v) || 0),
    z.number().optional()
  ),
});
export type UpdateKitTemplateBody = z.infer<typeof updateKitTemplateSchema>;
