/**
 * Live event stream — /api/events/stream (Server-Sent Events)
 *
 * Gated by the `features.liveDonationFeed` flag in Settings → Feature flags:
 * when the flag is off the endpoint answers 503 and no client connects.
 * The client checks the public settings payload first (which also exposes
 * the flag), so the stream is only opened when the feature is on.
 */
import { Router } from "express";
import { subscribeEvents } from "@/lib/events";
import { logger } from "@/lib/logger";
import { loadSettings } from "@/lib/notify";
import { isFlagOn } from "@/lib/settings-core";

const log = logger.child("events");

export const router = Router();

// GET /api/events/stream — public, unauthenticated (broadcasts are read-only)
router.get("/stream", async (_req, res) => {
  try {
    const map = await loadSettings();
    if (!isFlagOn(map["features.liveDonationFeed"])) {
      log.warn("event_stream_disabled");
      return res.status(503).json({ error: "Live donation feed is disabled" });
    }
    subscribeEvents(res);
  } catch (e) {
    log.error("stream_failed_to_open", { error: e instanceof Error ? e : String(e) });
    return res.status(500).json({ error: "Could not open event stream" });
  }
});
