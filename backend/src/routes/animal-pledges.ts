/**
 * Animal pledges admin route — /api/animal-pledges/:id
 * Thin endpoint definitions; all logic lives in src/modules/animal-pledges
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/animal-pledges`) is preserved.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  animalPledgeIdParamSchema,
  updateAnimalPledgeBodySchema,
} from "@/modules/animal-pledges/schemas/animal-pledge.schema";
import { animalPledgeController } from "@/modules/animal-pledges";

export const router = Router();

// PATCH /api/animal-pledges/:id (ADMIN)
// Accepts {status} alone (original contract) or any of donorName, amount,
// kind, frequency, shelterFund, animalId for full admin edits.
// Body field checks run in the service, after the legacy pledge lookup.
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: animalPledgeIdParamSchema, body: updateAnimalPledgeBodySchema }),
  animalPledgeController.update
);

// DELETE /api/animal-pledges/:id (ADMIN)
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: animalPledgeIdParamSchema }),
  animalPledgeController.remove
);
