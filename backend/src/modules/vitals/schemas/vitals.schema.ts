/**
 * Vitals schemas — Zod definitions for every /api/vitals request.
 * Validation messages and coercions match the legacy route exactly: absent/
 * null/empty fields are silently skipped, numbers coerce via Number(), and
 * out-of-range values reject with the same per-field messages.
 */
import { z } from "zod";

// Screening DATA ranges — vital observations are data capture, never
// diagnoses. Values outside these physiological plausibility windows are
// rejected so typos never reach the clinical record. (Shared with the
// service, which applies integer rounding + BMI from the same table.)
export const RANGES: Record<string, [number, number]> = {
  bpSystolic: [50, 300],
  bpDiastolic: [20, 200],
  pulse: [20, 250],
  tempC: [30, 45],
  respRate: [5, 80],
  spo2: [40, 100],
  glucose: [10, 1500],
  heightCm: [20, 280],
  weightKg: [0.5, 700],
};

/** Fields stored as integers (legacy Math.round after the range check). */
export const INT_FIELDS = new Set(["bpSystolic", "bpDiastolic", "pulse", "respRate", "spo2"]);

// ─── Shared coercion helpers (legacy pageParams semantics) ──────────────────

/** First value of a query param (legacy URLSearchParams.get semantics). */
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Legacy pageParams(): Math.max(1, Math.trunc(Number(v) || 1)). */
const legacyPage = z.preprocess(
  (v) => Math.max(1, Math.trunc(Number(first(v) ?? null) || 1)),
  z.number().int().min(1)
);

/** Legacy pageParams(): Math.min(200, Math.max(1, Math.trunc(Number(v) || def))). */
const legacyLimit = (def: number) =>
  z.preprocess(
    (v) => Math.min(200, Math.max(1, Math.trunc(Number(first(v) ?? null) || def))),
    z.number().int().min(1)
  );

/** Optional query string filter — absent/empty means "no filter" (legacy `if (v)`). */
const queryFilter = z.preprocess((v) => {
  const s = first(v);
  return typeof s === "string" && s ? s : undefined;
}, z.string().optional());

/** One measured vital field: undefined/null/"" skip silently (legacy `continue`),
 *  then Number() coercion + range check with the legacy messages. */
const vitalField = (field: string, range: [number, number]) => {
  const [min, max] = range;
  return z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    z.coerce
      .number({ error: `${field} must be a number` })
      .min(min, `${field} must be between ${min} and ${max}`)
      .max(max, `${field} must be between ${min} and ${max}`)
      .optional()
  );
};

// ─── GET /api/vitals ─────────────────────────────────────────────────────────

export const listVitalsQuerySchema = z.object({
  page: legacyPage,
  limit: legacyLimit(50),
  beneficiaryId: queryFilter,
  campId: queryFilter,
  encounterId: queryFilter,
});
export type ListVitalsQuery = z.infer<typeof listVitalsQuerySchema>;

// ─── POST /api/vitals ────────────────────────────────────────────────────────

export const createVitalsSchema = z.object({
  beneficiaryId: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().min(1, "beneficiaryId is required")
  ),
  campId: z.preprocess((v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  }, z.string().nullable()),
  encounterId: z.preprocess((v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  }, z.string().nullable()),
  bpSystolic: vitalField("bpSystolic", RANGES.bpSystolic),
  bpDiastolic: vitalField("bpDiastolic", RANGES.bpDiastolic),
  pulse: vitalField("pulse", RANGES.pulse),
  tempC: vitalField("tempC", RANGES.tempC),
  respRate: vitalField("respRate", RANGES.respRate),
  spo2: vitalField("spo2", RANGES.spo2),
  heightCm: vitalField("heightCm", RANGES.heightCm),
  weightKg: vitalField("weightKg", RANGES.weightKg),
  glucose: vitalField("glucose", RANGES.glucose),
});
export type CreateVitalsBody = z.infer<typeof createVitalsSchema>;
