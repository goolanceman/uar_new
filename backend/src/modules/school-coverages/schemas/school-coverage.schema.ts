/**
 * School coverage schemas — /api/school-coverages input.
 *
 * The legacy route coerced every field with String()/Number()/Boolean() and
 * truthiness checks; the preprocessors below reproduce those expressions
 * verbatim so no input the legacy accepted is rejected now:
 *   schoolName  String(body?.schoolName ?? "").trim()     → "" rejects
 *   totalGirls  Number(body?.totalGirls ?? 0)             → finite and >= 0
 *   address/city/contactPerson/contactPhone   truthy ? String(v).trim() : null
 *   lastVisited keeps its raw value (Date conversion stays in the service, so
 *               an unparseable value still fails in Prisma exactly like legacy)
 *   isActive    body?.isActive === undefined ? true : Boolean(body.isActive)
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?q[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// GET /api/school-coverages?q=&active=1
export const listSchoolCoveragesQuerySchema = z.object({
  q: spGet.transform((v) => (v !== undefined ? v.trim() : undefined)),
  active: spGet.transform((v) => v === "1"),
});
export type ListSchoolCoveragesQuery = z.infer<typeof listSchoolCoveragesQuerySchema>;

// POST /api/school-coverages — non-object bodies became {} in legacy
// ((req.body ?? {}).x → undefined), so they normalize to {} here too.
export const createSchoolCoverageSchema = z.preprocess(
  (body) =>
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {},
  z.object({
    schoolName: z.preprocess((v) => String(v ?? ""), z.string().trim().min(1, "School name is required")),
    totalGirls: z.preprocess(
      (v) => (v === undefined || v === null ? 0 : Number(v)),
      z
        .number({ error: "Total girls must be zero or more" })
        .refine((n) => Number.isFinite(n) && n >= 0, "Total girls must be zero or more")
    ),
    address: z.preprocess((v) => (v ? String(v).trim() : null), z.string().nullable()),
    city: z.preprocess((v) => (v ? String(v).trim() : null), z.string().nullable()),
    contactPerson: z.preprocess((v) => (v ? String(v).trim() : null), z.string().nullable()),
    contactPhone: z.preprocess((v) => (v ? String(v).trim() : null), z.string().nullable()),
    // Raw pass-through: legacy built `new Date(String(v))` lazily and let an
    // Invalid Date fail in Prisma — reproducing that needs the raw value.
    lastVisited: z.unknown().optional(),
    isActive: z.preprocess((v) => (v === undefined ? true : Boolean(v)), z.boolean()),
  })
);
export type CreateSchoolCoverageBody = z.infer<typeof createSchoolCoverageSchema>;
