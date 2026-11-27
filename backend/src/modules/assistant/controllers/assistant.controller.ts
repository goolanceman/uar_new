/**
 * Assistant controller — HTTP layer only. The two mid-handler gates (the
 * empty-message 400 and the rate-limit 429) stay here because the legacy
 * route evaluated them in exact order between/after the session validation
 * and they respond with exact wire bodies; the session lookup must read the
 * request directly. Everything else is delegated to the service. Errors flow
 * to the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validateSession } from "@/infrastructure/auth/session";
import { checkRateLimit, clientIp } from "@/infrastructure/cache/rate-limit";
import type { ChatRequestBody } from "../schemas/assistant.schema";
import type { AssistantService } from "../services/assistant.service";

export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  /** POST /api/assistant/chat */
  chat: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = (req.body ?? {}) as ChatRequestBody;
      // Preserved verbatim: a non-string message crashes into the 500 path
      // exactly like the legacy route (no invented coercion/rejection).
      const message = ((body.message as string | undefined) ?? "").trim();
      if (!message) {
        res.status(400).json({ error: "Message is required" });
        return;
      }

      // The role gates access to ADMIN/VOLUNTEER-only live operations data
      // (inventory, donors, analytics) below, so it MUST come from the
      // verified session, never from the client-supplied request body.
      // validateSession (not the sync getSession) so a REVOKED token cannot
      // keep claiming a staff role; guests (no session) stay welcome.
      const session = await validateSession(req);
      const role = session?.role ?? "PUBLIC";

      // External-LLM cost control (gap A-7): 20 chats / hour, keyed by the
      // session userId when signed in, else by client IP — guests never 401.
      const rl = checkRateLimit(
        `assistant:chat:${session?.userId ?? clientIp(req.headers)}`,
        20,
        60 * 60 * 1000
      );
      if (!rl.allowed) {
        res.status(429).json({ error: "Too many requests — please try again in a while." });
        return;
      }

      const payload = await this.assistantService.chat({
        message,
        history: body.history ?? [],
        role,
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
