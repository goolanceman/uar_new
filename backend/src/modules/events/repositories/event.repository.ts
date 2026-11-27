/**
 * Settings read for the events module, delegating to the shared settings
 * loader (@/infrastructure/notifications/notify — cached KV map over the Setting table). Named Lib*
 * because the Prisma call stays in the shared lib (read-only for this module).
 */
import { loadSettings } from "@/infrastructure/notifications/notify";
import type { SettingsMap } from "@/domains/settings-core";
import type { EventRepository } from "./event.repository.interface";

export class LibEventRepository implements EventRepository {
  loadSettingsMap(): Promise<SettingsMap> {
    return loadSettings();
  }
}
