/**
 * Receipt routes — /api/receipts, /api/receipts/:receiptNumber, /api/receipts/:receiptNumber/html
 * Thin endpoint definitions; all logic lives in src/modules/receipts
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/receipts`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listReceiptsQuerySchema,
  receiptNumberParamSchema,
} from "@/modules/receipts/schemas/receipt.schema";
import { receiptController } from "@/modules/receipts";

export const router = Router();

// GET /api/receipts?from&to&limit — 80G receipt list (completed donations).
// ADMIN: every completed donation · other signed-in roles: only their own
// donations (matched by donorId or donorEmail). Newest first. (Legacy gate:
// `await requireAuth(req)` as the handler's first step.)
router.get("/", authenticate, validate({ query: listReceiptsQuerySchema }), receiptController.list);

// GET /api/receipts/:receiptNumber — receipt detail + issuing org profile.
// Public by capability: the receipt number itself is the secret link
// (printed on the receipt and shared with the donor).
router.get(
  "/:receiptNumber",
  validate({ params: receiptNumberParamSchema }),
  receiptController.get
);

// GET /api/receipts/:receiptNumber/html — self-contained, print-ready A4
// 80G donation receipt. Public with the receipt number acting as the
// capability.
router.get(
  "/:receiptNumber/html",
  validate({ params: receiptNumberParamSchema }),
  receiptController.html
);
