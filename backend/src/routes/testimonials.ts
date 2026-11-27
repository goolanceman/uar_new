/**
 * Testimonials routes — /api/testimonials, /api/testimonials/:id
 * Thin endpoint definitions; all logic lives in src/modules/testimonials
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/testimonials`) is preserved.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createTestimonialSchema,
  testimonialIdParamSchema,
  updateTestimonialBodySchema,
} from "@/modules/testimonials/schemas/testimonial.schema";
import { testimonialController } from "@/modules/testimonials";

export const router = Router();

// GET /api/testimonials — public wall
router.get("/", testimonialController.list);

// POST /api/testimonials — admin curates
router.post("/", authorize("ADMIN"), validate({ body: createTestimonialSchema }), testimonialController.create);

// PATCH /api/testimonials/:id — admin edits (body field checks run in the
// service, after the legacy existence lookup)
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: testimonialIdParamSchema, body: updateTestimonialBodySchema }),
  testimonialController.update
);

// DELETE /api/testimonials/:id — admin removes
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: testimonialIdParamSchema }),
  testimonialController.remove
);
