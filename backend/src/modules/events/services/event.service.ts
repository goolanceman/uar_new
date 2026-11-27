/**
 * Event stream service — the live-donation-feed gate. Loads the settings map
 * and evaluates features.liveDonationFeed; the 503/500 HTTP mapping and the
 * SSE wiring stay in the controller (legacy ordering preserved: the flag
 * check and its log happen before any response is written).
 */
import { logger } from "@/lib/logger";
import { isFlagOn } from "@/lib/settings-core";
import type { EventRepository } from "../repositories/event.repository.interface";

const log = logger.child("events");

export class EventService {
  constructor(private readonly eventRepository: EventRepository) {}

  /** True when features.liveDonationFeed is on; logs the domain event when off. */
  async isLiveFeedEnabled(): Promise<boolean> {
    const map = await this.eventRepository.loadSettingsMap();
    const on = isFlagOn(map["features.liveDonationFeed"]);
    if (!on) log.warn("event_stream_disabled");
    return on;
  }
}
