/**
 * Users routes — /api/users, /api/users/:id
 * Thin endpoint definitions; all logic lives in src/modules/users
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/users`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listUsersQuerySchema,
  userBodySchema,
  userIdParamSchema,
} from "@/modules/users/schemas/user.schema";
import { userController } from "@/modules/users";

export const router = Router();

// GET /api/users?q&role&status — admin directory.
router.get("/", authorize("ADMIN"), validate({ query: listUsersQuerySchema }), userController.list);

// POST /api/users — admin creates a user.
// (Field checks run in the service — legacy order and messages.)
router.post("/", authorize("ADMIN"), validate({ body: userBodySchema }), userController.create);

// GET /api/users/:id (ADMIN) — full record + recent audit-trail entries for
// the detail sheet's Activity tab.
router.get("/:id", authorize("ADMIN"), validate({ params: userIdParamSchema }), userController.get);

// PATCH /api/users/:id — admin edits a user.
// (Field checks run in the service — legacy order and messages.)
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: userIdParamSchema, body: userBodySchema }),
  userController.update
);

// DELETE /api/users/:id — admin removes a user (community cascade via
// deleteUserCascade plus the CRM detachments).
router.delete("/:id", authorize("ADMIN"), validate({ params: userIdParamSchema }), userController.remove);
