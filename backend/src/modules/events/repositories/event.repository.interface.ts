/**
 * Event stream repository contract — the settings read that backs the
 * live-donation-feed feature flag. The module needs no other persistence:
 * the SSE hub itself lives in @/lib/events (shared infra).
 */
import type { SettingsMap } from "@/lib/settings-core";

export interface EventRepository {
  /** Load the settings KV map (cached) — legacy called loadSettings() directly. */
  loadSettingsMap(): Promise<SettingsMap>;
}
