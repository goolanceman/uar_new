/**
 * Sponsorship schemas — request definitions for /api/sponsorships.
 *
 * Legacy read the query with URLSearchParams.get() (silent coercion) and
 * validated POST/PATCH bodies mid-handler, interleaved with beneficiary/
 * donor/recurring-need lookups and donor-ownership gates, so the query
 * schema reproduces the sp.get() expressions verbatim and the body schemas
 * are permissive envelopes — the exact field checks live in the service.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?mine[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/sponsorships?beneficiaryId=&donorId=&status=&mine= ─────────────

/** `sp.get("mine")` is a bare truthiness check — any non-empty value (even
 *  "0") enables the donor self-scope; `?mine=` (empty) does not. */
export const listSponsorshipsQuerySchema = z.object({
  mine: spGet.transform((v) => v !== undefined && v !== ""),
  beneficiaryId: spGet,
  donorId: spGet,
  status: spGet,
});
export type ListSponsorshipsQuery = z.infer<typeof listSponsorshipsQuerySchema>;

// ─── :id params ───────────────────────────────────────────────────────────────

/** The id reaches the existence lookup verbatim (no legacy trim/check). */
export const sponsorshipIdParamSchema = z.object({
  id: z.string(),
});
export type SponsorshipIdParams = z.infer<typeof sponsorshipIdParamSchema>;

// ─── POST / PATCH bodies ─────────────────────────────────────────────────────

/** Permissive body envelopes: legacy read `(req.body ?? {})` and validated
 *  fields mid-handler between DB lookups (beneficiary/donor/need existence,
 *  donor self-service gates). The service applies the exact legacy checks
 *  with the original error messages and ordering. */
export const createSponsorshipBodySchema = z.any();
export type CreateSponsorshipBody = Record<string, unknown>;

export const updateSponsorshipBodySchema = z.any();
export type UpdateSponsorshipBody = Record<string, unknown>;
