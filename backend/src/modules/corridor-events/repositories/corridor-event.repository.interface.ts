/**
 * Corridor event repository contract — the mission corridor alert feed.
 */
export interface CorridorEventFilter {
  missionId?: string;
  method?: string;
  congestion?: string;
  limit: number;
}

export interface CorridorEventWithMission {
  id: string;
  missionId: string;
  segment: string;
  method: string;
  congestion: string;
  vehiclesAlerted: number;
  timeSavedSec: number;
  note: string | null;
  createdAt: Date;
  mission: { requestRef: string };
}

export interface CorridorEventRepository {
  /** Newest first, bounded take, mission requestRef attached (legacy include). */
  list(filter: CorridorEventFilter): Promise<CorridorEventWithMission[]>;
}
