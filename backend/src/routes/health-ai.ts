/**
 * Health AI routes — thin endpoint definitions; all logic lives in
 * src/modules/health-ai (routes → controllers → services → repositories).
 * The historical export path (`@/routes/health-ai`) is preserved: tests and
 * the app entry import `router` from here.
 *
 * /api/health-ai, /api/health-ai/:id
 * Converted 1:1 from src/app/api/health-ai/* (Next.js route handlers) to Express.
 *
 * ─── AI governance (spec) ─────────────────────────────────────────────────────
 * AI is an ASSISTANT here, never an actor: no auto-signing, no auto-dispensing,
 * no auto-diagnoses. Every interaction is stored as a PENDING AIInteraction
 * with minimised digests (length + truncated hash — never full notes/PHI) and
 * needs human APPROVAL before the client applies anything through the normal
 * record APIs. If the AI SDK is unavailable, consult-draft / timeline-summary /
 * doc-extract fail 503 with NO interaction row written — AI is never a silent
 * dependency — while camp-plan degrades to a deterministic offline plan built
 * from the same aggregate stats (still recorded as PENDING for review).
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  aiInteractionIdParamSchema,
  healthAiBodySchema,
} from "@/modules/health-ai/schemas/health-ai.schema";
import { healthAiController } from "@/modules/health-ai";

export const router = Router();

// GET /api/health-ai — ADMIN lists recent AIInteraction rows for audit.
router.get("/", authorize("ADMIN"), healthAiController.list);

// POST /api/health-ai — role-gated AI actions:
//   consult-draft (DOCTOR) · timeline-summary (DOCTOR|ADMIN)
//   camp-plan (ADMIN) · doc-extract (ADMIN|DOCTOR|NURSE)
// The rate-limit 429 responds mid-handler exactly like the legacy route.
router.post("/", authenticate, validate({ body: healthAiBodySchema }), healthAiController.post);

// PATCH /api/health-ai/:id — human review of an AI interaction (audit trail).
// ADMIN | DOCTOR sets status APPROVED | REJECTED; reviewedByName is stamped
// from the session automatically — clients cannot forge the reviewer.
// The AI output itself is NEVER applied by this endpoint: the client applies
// accepted data through the normal record APIs afterwards.
router.patch(
  "/:id",
  authorize("ADMIN", "DOCTOR"),
  validate({ params: aiInteractionIdParamSchema, body: healthAiBodySchema }),
  healthAiController.review
);
