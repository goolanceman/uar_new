/**
 * Health AI controller — HTTP layer only. Extracts validated data / session,
 * applies the two mid-handler gates exactly like the legacy route (the
 * rate-limit 429 responds directly), delegates to the service, returns the
 * response. Errors flow to the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import { checkRateLimit } from "@/infrastructure/cache/rate-limit";
import type { AiInteractionIdParams, HealthAiBody } from "../schemas/health-ai.schema";
import type { HealthAiService } from "../services/health-ai.service";

/** Legacy local pageParams — Math.trunc(Number(...)) with [1,200] clamp. */
function pageParams(url: URL, defLimit = 50) {
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || defLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

export class HealthAiController {
  constructor(private readonly healthAiService: HealthAiService) {}

  /** GET /api/health-ai — ADMIN lists recent AIInteraction rows for audit. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Legacy parsed ?page=&limit=&action=&status= from URL searchParams
      // (first-value semantics) — preserved verbatim.
      const url = new URL(req.url, "http://localhost");
      const { page, limit, skip } = pageParams(url);
      const action = url.searchParams.get("action");
      const status = url.searchParams.get("status");

      const payload = await this.healthAiService.list(page, limit, skip, action, status);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/health-ai — role-gated AI actions (consult-draft,
   *  timeline-summary, camp-plan, doc-extract). */
  post: RequestHandler = async (req, res, next) => {
    try {
      const session = req.session!;
      // External-LLM cost control (gap A-7): 20 AI calls / hour per account.
      const rl = checkRateLimit(`health-ai:${session.userId}`, 20, 60 * 60 * 1000);
      if (!rl.allowed) {
        res.status(429).json({ error: "Too many AI requests — please try again in a while." });
        return;
      }
      const body = validatedBody<HealthAiBody>(req) ?? {};
      const result = await this.healthAiService.post(session, body, {
        url: req.url,
        protocol: req.protocol,
        host: req.headers.host,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/health-ai/:id — human review of an AI interaction. */
  review: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AiInteractionIdParams>(req);
      const body = validatedBody<HealthAiBody>(req) ?? {};
      const interaction = await this.healthAiService.review(id, body, req.session!);
      res.json(interaction);
    } catch (error) {
      next(error);
    }
  };
}
