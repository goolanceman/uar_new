/**
 * Event stream controller — HTTP layer for the SSE endpoint.
 *
 * Deliberately keeps the legacy inline catch instead of next(error): any
 * failure here answered 500 {"Could not open event stream"} — a FIXED message
 * plus the stream_failed_to_open log event — while the centralized handler
 * would echo the raw error message instead. subscribeEvents(res) is an SSE
 * transport helper and stays at the HTTP layer.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger } from "@/lib/logger";
import { subscribeEvents } from "@/lib/events";
import type { EventService } from "../services/event.service";

const log = logger.child("events");

export class EventController {
  constructor(private readonly eventService: EventService) {}

  /** GET /api/events/stream — public, unauthenticated (broadcasts are read-only). */
  stream: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const enabled = await this.eventService.isLiveFeedEnabled();
      if (!enabled) {
        res.status(503).json({ error: "Live donation feed is disabled" });
        return;
      }
      subscribeEvents(res);
    } catch (e) {
      log.error("stream_failed_to_open", { error: e instanceof Error ? e : String(e) });
      res.status(500).json({ error: "Could not open event stream" });
    }
  };
}
