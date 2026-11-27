/**
 * Kit template routes — /api/kit-templates, /api/kit-templates/:id
 * Thin endpoint definitions; all logic lives in src/modules/kit-templates
 * (routes → controllers → services → repositories).
 * Converted 1:1 from src/app/api/kit-templates/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createKitTemplateSchema,
  updateKitTemplateSchema,
} from "@/modules/kit-templates/schemas/kit-template.schema";
import { kitTemplateController } from "@/modules/kit-templates";

export const router = Router();

// GET /api/kit-templates (auth) — incl. _count batches
router.get("/", authenticate, kitTemplateController.list);

// POST /api/kit-templates (ADMIN) — {name, description?, items:[{name,qty,unit}], costPerUnit}
router.post(
  "/",
  authorize("ADMIN"),
  validate({ body: createKitTemplateSchema }),
  kitTemplateController.create
);

// PATCH /api/kit-templates/:id (ADMIN)
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: updateKitTemplateSchema }),
  kitTemplateController.update
);

// DELETE /api/kit-templates/:id (ADMIN) — blocked when batches exist
router.delete("/:id", authorize("ADMIN"), validate({ params: stringIdParamSchema }), kitTemplateController.remove);
