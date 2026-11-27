/**
 * Animal pledge schemas — Zod definitions for /api/animal-pledges requests.
 *
 * Legacy validated the PATCH body per-field AFTER the pledge existence
 * lookup (a missing pledge returned 404 before any body check ran), so the
 * per-field coercions/messages are enforced in the service to preserve that
 * ordering. The body schema below therefore accepts anything — no new
 * rejections are invented at the route layer.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** Pledge ids are cuid strings — `:id` segments are never empty. */
export const animalPledgeIdParamSchema = stringIdParamSchema;
export type AnimalPledgeIdParams = z.infer<typeof animalPledgeIdParamSchema>;

/**
 * Permissive body envelope: legacy silently accepted any JSON body
 * (`req.body ?? {}`) and validated known fields mid-handler. The service
 * applies the exact legacy field checks (status/donorName/amount/kind/
 * frequency/shelterFund/animalId) with the original error messages.
 */
export const updateAnimalPledgeBodySchema = z.any();
export type UpdateAnimalPledgeBody = Record<string, unknown>;
