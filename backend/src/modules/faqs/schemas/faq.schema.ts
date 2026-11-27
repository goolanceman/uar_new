/**
 * FAQ catalog schemas — Zod definitions for every /api/faqs request.
 * Validation messages match the legacy route errors exactly so existing
 * clients see identical responses.
 */
import { z } from "zod";
import { pageQuerySchema } from "@/shared/schemas/common";

// ─── Public list ─────────────────────────────────────────────────────────────

export const listFaqsQuerySchema = pageQuerySchema();
export type ListFaqsQuery = z.infer<typeof listFaqsQuerySchema>;

// ─── FAQ types (admin) ───────────────────────────────────────────────────────

export const createFaqTypeSchema = z.object({
  title: z
    .string({ error: "The title field is required." })
    .trim()
    .min(1, "The title field is required.")
    .max(55, "The title may be at most 55 characters."),
});
export type CreateFaqTypeBody = z.infer<typeof createFaqTypeSchema>;

export const updateFaqTypeSchema = createFaqTypeSchema;
export type UpdateFaqTypeBody = z.infer<typeof updateFaqTypeSchema>;

export const faqTypeIdParamSchema = z.object({
  id: z.coerce
    .number({ error: "Invalid FAQ type id" })
    .int("Invalid FAQ type id")
    .positive("Invalid FAQ type id"),
});
export type FaqTypeIdParams = z.infer<typeof faqTypeIdParamSchema>;

// ─── FAQs (admin) ────────────────────────────────────────────────────────────

export const createFaqSchema = z.object({
  faqsTypeId: z.coerce
    .number({ error: "The faqsTypeId field is required." })
    .int("Invalid faqsTypeId")
    .positive("Invalid faqsTypeId"),
  question: z
    .string({ error: "The question field is required." })
    .trim()
    .min(1, "The question field is required."),
  answer: z
    .string({ error: "The answer field is required." })
    .trim()
    .min(1, "The answer field is required."),
});
export type CreateFaqBody = z.infer<typeof createFaqSchema>;

/** PATCH body — at least one field must be present (service enforces the
 *  legacy "Nothing to update" 400 when the patch comes out empty). */
export const updateFaqSchema = z
  .object({
    faqsTypeId: z.coerce.number().int("Invalid faqsTypeId").positive("Invalid faqsTypeId").optional(),
    question: z.string().trim().min(1, "The question field is required.").optional(),
    answer: z.string().trim().min(1, "The answer field is required.").optional(),
  })
  .refine((v) => v.question !== undefined || v.answer !== undefined || v.faqsTypeId !== undefined, {
    message: "Nothing to update",
  });
export type UpdateFaqBody = z.infer<typeof updateFaqSchema>;

export const faqIdParamSchema = z.object({
  id: z.coerce
    .number({ error: "Invalid FAQ id" })
    .int("Invalid FAQ id")
    .positive("Invalid FAQ id"),
});
export type FaqIdParams = z.infer<typeof faqIdParamSchema>;
