/**
 * Master schemas — /api/masters input.
 *
 * The GET query read the raw URL search params (URLSearchParams.get()
 * semantics — the spGet preprocess); the truthiness of `categories` / `all`
 * picks the branch (an empty ?categories= value fell through in legacy, so
 * the raw string is kept and the controller checks truthiness).
 *
 * POST/PATCH bodies were coerced with String(...)/Number(...) AFTER the auth
 * gate (POST) or the existence lookup (PATCH — 404-before-400), throwing the
 * legacy combined messages ("category and value are required", "value cannot
 * be empty", the 409 value conflict). That validation stays in the service;
 * and because the legacy routes read req.body DIRECTLY (no ?? {} fallback —
 * a bodyless request crashed into the 500 path), the controllers keep the
 * raw body read instead of registering a body schema here.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?all[a]=1) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/masters ───────────────────────────────────────────────────────
//   ?categories=1  → distinct category strings (orderBy category)
//   ?all=1 (ADMIN) → every master row
//   ?category=X    → active {value,label}[] ordered by sortOrder
export const listMastersQuerySchema = z.object({
  categories: spGet,
  all: spGet,
  category: spGet,
});
export type ListMastersQuery = z.infer<typeof listMastersQuerySchema>;

/** :id is a cuid string — a missing id never matches the route segment. */
export const masterIdParamSchema = stringIdParamSchema;
export type MasterIdParams = z.infer<typeof masterIdParamSchema>;
