/**
 * FAQs routes — thin endpoint definitions; all logic lives in
 * src/modules/faqs (routes → controllers → services → repositories).
 * The historical export path (`@/routes/faqs`) is preserved: tests and the
 * app entry import `router` from here.
 */
import { Router } from "express";
import { elevated } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createFaqSchema,
  createFaqTypeSchema,
  faqIdParamSchema,
  faqTypeIdParamSchema,
  listFaqsQuerySchema,
  updateFaqSchema,
  updateFaqTypeSchema,
} from "@/modules/faqs/schemas/faq.schema";
import { faqController } from "@/modules/faqs";

export const router = Router();

// GET /api/faqs — FAQ categories (types) with nested questions/answers.
router.get("/", validate({ query: listFaqsQuerySchema }), faqController.list);

// ─── Admin CRUD — FAQ types ─────────────────────────────────────────────

// POST /api/faqs/types {title}
router.post("/types", elevated, validate({ body: createFaqTypeSchema }), faqController.createType);

// PATCH /api/faqs/types/:id {title}
router.patch(
  "/types/:id",
  elevated,
  validate({ params: faqTypeIdParamSchema, body: updateFaqTypeSchema }),
  faqController.updateType
);

// DELETE /api/faqs/types/:id — soft-delete the type and hard-delete its faqs
// (the legacy type delete emptied the section).
router.delete("/types/:id", elevated, validate({ params: faqTypeIdParamSchema }), faqController.deleteType);

// ─── Admin CRUD — FAQs ──────────────────────────────────────────────────

// POST /api/faqs {faqsTypeId, question, answer}
router.post("/", elevated, validate({ body: createFaqSchema }), faqController.create);

// PATCH /api/faqs/:id {question?, answer?, faqsTypeId?}
router.patch(
  "/:id",
  elevated,
  validate({ params: faqIdParamSchema, body: updateFaqSchema }),
  faqController.update
);

// DELETE /api/faqs/:id
router.delete("/:id", elevated, validate({ params: faqIdParamSchema }), faqController.remove);
