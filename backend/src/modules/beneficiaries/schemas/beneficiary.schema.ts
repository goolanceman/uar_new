/**
 * Beneficiary schemas — /api/beneficiaries input.
 *
 * The legacy GET handler parsed the query with URLSearchParams over the raw
 * URL and gated AUTH per-branch (mine=1 → self lookup, otherwise staff roles),
 * so every query field is a lenient extraction — nothing is rejected here.
 * The POST/PATCH/KYC/notes handlers validated body fields mid-handler AFTER
 * the auth gate (with the beneficiary lookup interleaved — 404-before-400
 * ordering), so those body schemas are permissive envelopes — the exact field
 * checks live in the service.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?q[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/beneficiaries?q=&category=&active=0/1 · ?mine=1 ────────────────

export const listBeneficiariesQuerySchema = z.object({
  /** legacy: sp.get("mine") === "1" — self case-record branch */
  mine: z.preprocess((v) => (Array.isArray(v) ? v[0] : v) === "1", z.boolean()),
  /** legacy: sp.get("q")?.trim() || undefined */
  q: spGet.transform((v) => v?.trim() || undefined),
  /** legacy: sp.get("category") || undefined (no trim) */
  category: spGet.transform((v) => v || undefined),
  /** legacy raw sp.get("active") — only "0"/"1" matter downstream */
  active: spGet,
  /** legacy raw sp.get("caseStatus") — uppercased when truthy in the filter */
  caseStatus: spGet,
  /** legacy raw sp.get("verificationStatus") */
  verificationStatus: spGet,
  /** legacy raw sp.get("hasRecurringNeeds") — only "1"/"0" matter downstream */
  hasRecurringNeeds: spGet,
  /** legacy raw sp.get("page") — presence (non-empty) triggers pagination */
  page: spGet,
  /** legacy raw sp.get("limit") */
  limit: spGet,
});
export type ListBeneficiariesQuery = z.infer<typeof listBeneficiariesQuerySchema>;

// ─── Params ──────────────────────────────────────────────────────────────────

/** Extraction-only param schema — the service renders the legacy 404. */
export const beneficiaryIdParamSchema = stringIdParamSchema;
export type BeneficiaryIdParams = z.infer<typeof beneficiaryIdParamSchema>;

// ─── POST /api/beneficiaries ─────────────────────────────────────────────────

/** Permissive body envelope: legacy read `req.body ?? {}` and validated
 *  name/category/urgencyLevel/pincode/age/gender/case/verification fields
 *  mid-handler. The service applies the exact legacy coercions and checks. */
export const createBeneficiaryBodySchema = z.any();
export type CreateBeneficiaryBody = Record<string, unknown>;

// ─── PATCH /api/beneficiaries/:id ────────────────────────────────────────────

/** Permissive body envelope: the 404 fires BEFORE body processing and the
 *  case/verification transition checks run against the loaded row — service
 *  keeps that order. */
export const updateBeneficiaryBodySchema = z.any();
export type UpdateBeneficiaryBody = Record<string, unknown>;

// ─── POST /api/beneficiaries/:id/kyc and /kyc/review ─────────────────────────

/** Permissive body envelopes: documentIds may arrive as an array OR a JSON
 *  string (multipart clients) — the lenient parse + exact error messages live
 *  in the service; the review status check likewise. */
export const submitKycBodySchema = z.any();
export type SubmitKycBody = Record<string, unknown>;

export const reviewKycBodySchema = z.any();
export type ReviewKycBody = Record<string, unknown>;

// ─── POST /api/beneficiaries/:id/notes ───────────────────────────────────────

/** Permissive body envelope — the "Note cannot be empty" check runs in the
 *  service after the auth gate (legacy order). */
export const createNoteBodySchema = z.any();
export type CreateNoteBody = Record<string, unknown>;
