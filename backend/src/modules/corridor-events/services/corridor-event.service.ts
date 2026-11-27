/**
 * Corridor event service — read model for the mission corridor alert feed.
 * Read-only passthrough: filters and the take bound are fixed by the schema
 * (legacy expressions), and the legacy route had no cache calls or log events.
 */
import type {
  CorridorEventFilter,
  CorridorEventRepository,
  CorridorEventWithMission,
} from "../repositories/corridor-event.repository.interface";

export class CorridorEventService {
  constructor(private readonly corridorEventRepository: CorridorEventRepository) {}

  /** GET /api/corridor-events — newest first, bounded take. */
  list(filter: CorridorEventFilter): Promise<CorridorEventWithMission[]> {
    return this.corridorEventRepository.list(filter);
  }
}
