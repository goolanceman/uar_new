/**
 * Donor CRM routes — /api/donors, /api/donors/:id
 * Thin endpoint definitions; all logic lives in src/modules/donors
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/donors`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { listDonorsQuerySchema } from "@/modules/donors/schemas/donor.schema";
import { donorController } from "@/modules/donors";

export const router = Router();

// GET /api/donors — admin donor CRM with aggregates + pagination
router.get("/", authorize("ADMIN"), validate({ query: listDonorsQuerySchema }), donorController.list);

// POST /api/donors — admin creates a donor record
router.post("/", authorize("ADMIN"), donorController.create);

// GET /api/donors/:id — donor 360 (profile + donations + pledges + certificates)
router.get("/:id", authorize("ADMIN"), donorController.detail);

// PATCH /api/donors/:id — admin edits donor profile
router.patch("/:id", authorize("ADMIN"), donorController.update);

// DELETE /api/donors/:id — remove CRM record (donations untouched)
router.delete("/:id", authorize("ADMIN"), donorController.remove);
