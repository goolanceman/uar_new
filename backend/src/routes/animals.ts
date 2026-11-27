/**
 * Animals routes — thin endpoint definitions; all logic lives in
 * src/modules/animals (routes → controllers → services → repositories).
 * The historical export path (`@/routes/animals`) is preserved: tests and
 * the app entry import `router` from here.
 *
 * /api/animals, /api/animals/pledges, /api/animals/reactions, /api/animals/:id
 * Converted 1:1 from src/app/api/animals/* (Next.js route handlers) to Express.
 *
 * Query strings are parsed from req.url with URL searchParams exactly like
 * the legacy handlers (first-value semantics), so no query schema is
 * mounted; body field checks run in the service with the exact legacy
 * messages and order.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  animalBodySchema,
  animalIdParamSchema,
} from "@/modules/animals/schemas/animal.schema";
import { animalController } from "@/modules/animals";

export const router = Router();

// GET /api/animals?species=&status=&q= (public) — includes each animal's pledges
router.get("/", animalController.list);

// POST /api/animals (ADMIN | VOLUNTEER)
router.post(
  "/",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ body: animalBodySchema }),
  animalController.create
);

// POST /api/animals/pledges — public (guests) OR authenticated donors
router.post("/pledges", validate({ body: animalBodySchema }), animalController.createPledge);

// GET /api/animals/pledges?mine=1&animalId= (auth)
router.get("/pledges", authenticate, animalController.listPledges);

// GET /api/animals/reactions?animalId=xxx  — public, recent blessings for one animal
// GET /api/animals/reactions                — public, recent blessings across all adopted animals
router.get("/reactions", animalController.listReactions);

// POST /api/animals/reactions — public (guests) OR authenticated users leave a blessing/reaction
router.post("/reactions", validate({ body: animalBodySchema }), animalController.createReaction);

// GET /api/animals/:id (ADMIN | VOLUNTEER) — animal + pledges
router.get("/:id", authorize("ADMIN", "VOLUNTEER"), validate({ params: animalIdParamSchema }), animalController.get);

// PATCH /api/animals/:id (ADMIN | VOLUNTEER)
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: animalIdParamSchema, body: animalBodySchema }),
  animalController.update
);

// DELETE /api/animals/:id (ADMIN)
router.delete("/:id", authorize("ADMIN"), validate({ params: animalIdParamSchema }), animalController.remove);
