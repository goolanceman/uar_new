/**
 * Animal schemas — request definitions for /api/animals*.
 *
 * The legacy routes read queries with URL searchParams and bodies with
 * hand-rolled `String(...)` coercions whose checks run in an exact order and
 * reply with bare messages ("name is required" — the first failing field
 * only). That ordering cannot be expressed in Zod without merging issues
 * into a combined message, so the body schemas are permissive envelopes and
 * the exact coercions/checks live in the service (same pattern as
 * modules/chat and modules/animal-pledges). No new rejections are invented.
 *
 * `:id` params are cuid strings — Express never matches an empty segment,
 * so the string param schema is a safe passthrough.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

export const animalIdParamSchema = stringIdParamSchema;
export type AnimalIdParams = z.infer<typeof animalIdParamSchema>;

/** Permissive body envelope — legacy read `(req.body ?? {})` field by field. */
export const animalBodySchema = z.any();
export type AnimalBody = Record<string, unknown>;
