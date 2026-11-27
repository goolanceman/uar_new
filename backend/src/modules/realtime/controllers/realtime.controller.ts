/**
 * Realtime controller — HTTP layer only. Extracts the raw/validated body and
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error) — with ONE legacy exception:
 * POST /auth rendered every failure itself (401/403/500 bodies are part of
 * the Pusher client contract), so it keeps the exact inline flow.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger } from "@/infrastructure/logging/logger";
import { validateSession } from "@/infrastructure/auth/session";
import { validatedBody } from "@/shared/middleware/validate";
import type { RealtimeService } from "../services/realtime.service";
import type { AgoraTokenBody } from "../schemas/realtime.schema";

const log = logger.child("realtime");

export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  /**
   * POST /api/realtime/auth — Pusher private-channel authorization.
   * websocket_service.dart posts {socket_id, channel_name} with the session
   * Bearer [redacted]; the response is {auth: "<appKey>:<hmac>"}. The channel name
   * is authorized per type (see RealtimeService.authorizeChannelAccess) before
   * signing — a valid session alone does NOT grant every private channel.
   */
  broadcastingAuth: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const socketId = req.body?.socket_id;
      const channelName = req.body?.channel_name;
      if (!socketId || !channelName) {
        res.status(401).json({ error: "Invalid auth request" });
        return;
      }
      const session = await validateSession(req);
      if (!session) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      if (!(await this.realtimeService.authorizeChannelAccess(session.userId, channelName))) {
        log.warn("channel_access_denied", { channel: channelName, actor: session.userId });
        res.status(403).json({ error: "Channel access denied" });
        return;
      }
      res.json({ auth: this.realtimeService.signChannel(socketId, channelName) });
    } catch (e) {
      // Legacy contract: auth failures never leaked internals — the handler
      // logged channel_auth_failed and answered a flat 500 "auth failed".
      log.error("channel_auth_failed", {
        error: e instanceof Error ? e : String(e),
        channel: String(req.body?.channel_name ?? ""),
      });
      res.status(500).json({ error: "auth failed" });
    }
  };

  /**
   * POST /api/realtime/agora-token — Agora RTC token for a channel (legacy
   * POST /generateAgoraToken). Session gate lives on the route
   * (authenticate — the legacy handler's first step was requireAuth).
   */
  agoraToken: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<AgoraTokenBody>(req);
      const token = await this.realtimeService.createAgoraToken(body.channelName, req.session!);
      res.json({ token });
    } catch (error) {
      next(error);
    }
  };
}
