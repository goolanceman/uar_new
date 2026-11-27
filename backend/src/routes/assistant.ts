/**
 * Assistant routes — thin endpoint definitions; all logic lives in
 * src/modules/assistant (routes → controllers → services → repositories).
 * The historical export path (`@/routes/assistant`) is preserved: tests and
 * the app entry import `router` from here.
 */
import { Router } from "express";
import { assistantController } from "@/modules/assistant";

export const router = Router();

// POST /api/assistant/chat — PUBLIC (guests welcome). The optional session is
// validated mid-handler by the controller (validateSession) so a revoked
// token cannot claim a staff role; no auth middleware on purpose.
router.post("/chat", assistantController.chat);
