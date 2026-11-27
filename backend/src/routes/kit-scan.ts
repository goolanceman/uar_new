/**
 * Kit scan routes — thin endpoint definitions; all logic lives in
 * src/modules/kit-scan (routes → controllers → services → repositories).
 * The historical export path (`@/routes/kit-scan`) is preserved: tests and
 * the app entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { kitScanController } from "@/modules/kit-scan";

export const router = Router();

// POST /api/kit-scan (VOLUNTEER | ADMIN) — {code, location?}
router.post("/", authorize("VOLUNTEER", "ADMIN"), kitScanController.scan);
