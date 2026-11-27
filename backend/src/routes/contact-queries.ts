/**
 * Contact query routes — /api/contact-queries, /api/contact-queries/:id
 * Thin endpoint definitions; all logic lives in src/modules/contact-queries
 * (routes → controllers → services → repositories).
 * Converted 1:1 from src/app/api/contact-queries/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createContactQuerySchema,
  listContactQueriesQuerySchema,
  updateContactQuerySchema,
} from "@/modules/contact-queries/schemas/contact-query.schema";
import { contactQueryController } from "@/modules/contact-queries";

export const router = Router();

// GET /api/contact-queries?status — admin inbox
router.get(
  "/",
  authorize("ADMIN"),
  validate({ query: listContactQueriesQuerySchema }),
  contactQueryController.list
);

// POST /api/contact-queries — public contact form
router.post("/", validate({ body: createContactQuerySchema }), contactQueryController.create);

// PATCH /api/contact-queries/:id — admin updates query status
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: updateContactQuerySchema }),
  contactQueryController.update
);

// DELETE /api/contact-queries/:id — admin removes a query
router.delete("/:id", authorize("ADMIN"), validate({ params: stringIdParamSchema }), contactQueryController.remove);
