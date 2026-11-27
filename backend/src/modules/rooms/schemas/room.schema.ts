/**
 * Room schemas — request definitions for /api/rooms.
 *
 * Legacy parsed the query with the shared community pageParams() (silent
 * String()/parseInt coercion) and read multipart bodies with silent coercion
 * helpers (numParam/String), so the query schemas reproduce those expressions
 * verbatim over the raw qs values and the body schema is a permissive
 * envelope — the exact field coercions live in the service.
 */
import { z } from "zod";

/** Raw query value passthrough (post-qs parse): repeated params stay arrays
 *  and object encodings stay objects, exactly what legacy String()/Number()
 *  coercions consumed. */
const rawGet = z.preprocess((v) => v, z.any().optional());

/** The uploaded-file lookup + URL building touches req, and the legacy
 *  `param()` guard ("id is required", 400) keeps its exact message in the
 *  controller — so path-param schemas here stay permissive. */
export const roomIdParamsSchema = z.object({
  id: z.string(),
});
export const roomUserParamsSchema = z.object({
  id: z.string(),
  userId: z.string(),
});
export const interestIdParamsSchema = z.object({
  interestId: z.string(),
});
export type RoomIdParams = z.infer<typeof roomIdParamsSchema>;
export type RoomUserParams = z.infer<typeof roomUserParamsSchema>;
export type InterestIdParams = z.infer<typeof interestIdParamsSchema>;

// ─── Page/limit queries (legacy pageParams over req.query) ───────────────────

/** lib pageParams(): page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1);
 *  limit = Math.min(100, Math.max(1, parseInt(String(q.limit ?? def), 10) || def)). */
const pageQuery = (defLimit: number) =>
  z.object({
    page: rawGet.transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1)),
    limit: rawGet.transform((v) => Math.min(100, Math.max(1, parseInt(String(v ?? defLimit), 10) || defLimit))),
  });

/** defLimit=100 variants (legacy pageParams(req.query, 100)). */
export const ownRoomsQuerySchema = pageQuery(100);
export type OwnRoomsQuery = z.infer<typeof ownRoomsQuerySchema>;

/** defLimit=20 default variant (legacy pageParams(req.query)). */
export const defaultPageQuerySchema = pageQuery(20);
export type DefaultPageQuery = z.infer<typeof defaultPageQuerySchema>;

// ─── GET /api/rooms/random ────────────────────────────────────────────────────

/** Math.max(1, Math.min(100, numParam(req.query.limit) ?? 20)) — numParam
 *  returns undefined for missing/empty/non-numeric, else the finite number. */
export const randomRoomsQuerySchema = z.object({
  limit: rawGet.transform((v) => {
    if (v === undefined || v === null || v === "") return Math.max(1, Math.min(100, 20));
    const n = Number(v);
    return Math.max(1, Math.min(100, Number.isFinite(n) ? n : 20));
  }),
});
export type RandomRoomsQuery = z.infer<typeof randomRoomsQuerySchema>;

// ─── GET /api/rooms/:id?showMembers= ──────────────────────────────────────────

/** numParam(req.query.showMembers) === 1 || req.query.showMembers === "true". */
export const roomDetailQuerySchema = z.object({
  showMembers: rawGet.transform((v) => {
    if (v === undefined || v === null || v === "") return false;
    const n = Number(v);
    return (Number.isFinite(n) ? n : undefined) === 1 || v === "true";
  }),
});
export type RoomDetailQuery = z.infer<typeof roomDetailQuerySchema>;

// ─── GET /api/rooms/:id/invitable-users?q= ────────────────────────────────────

/** Legacy read q raw: String(req.query.q ?? ""). */
export const invitableUsersQuerySchema = z.object({
  page: rawGet.transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1)),
  limit: rawGet.transform((v) => Math.min(100, Math.max(1, parseInt(String(v ?? "20"), 10) || 20))),
  q: rawGet,
});
export type InvitableUsersQuery = z.infer<typeof invitableUsersQuerySchema>;

// ─── POST / PATCH multipart bodies ───────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and coerced known
 *  fields with String()/numParam() mid-handler. The service applies the exact
 *  legacy coercions. */
export const roomBodySchema = z.any();
export type RoomBody = Record<string, unknown>;
