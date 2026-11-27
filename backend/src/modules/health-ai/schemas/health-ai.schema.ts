/**
 * Health AI schemas — request definitions for /api/health-ai*.
 *
 * The POST body is an arbitrary {…} whose `action` routes to four different
 * branch flows with mid-flow DB lookups (404-before-400 ordering) and exact
 * bare error messages — the per-field checks therefore live in the service
 * and the body schema is a permissive envelope. The GET list read its query
 * from `new URL(req.url).searchParams` (first-value semantics) with silent
 * Math.trunc coercion — that URL parsing is preserved verbatim in the
 * controller, so no query schema is mounted. `:id` params are cuid strings
 * that Express never matches empty — a safe passthrough.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

export const aiInteractionIdParamSchema = stringIdParamSchema;
export type AiInteractionIdParams = z.infer<typeof aiInteractionIdParamSchema>;

/** Permissive body envelope — legacy read `(req.body ?? {})` field by field. */
export const healthAiBodySchema = z.any();
export type HealthAiBody = Record<string, unknown>;
