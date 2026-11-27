/**
 * Mission repository contract — mission rows, ambulance lookups and corridor
 * events. The service layer depends on this interface, never on Prisma
 * directly.
 */
import type { Ambulance, CorridorEvent, Mission } from "@prisma/client";

export type MissionRow = Mission;
export type AmbulanceRow = Ambulance;
export type CorridorEventRow = CorridorEvent;

/** GET / list shape — mission with the ambulance code/type/driver summary. */
export type MissionListRow = Mission & {
  ambulance: { code: string; type: string; driverName: string } | null;
};

/** Mutation shapes that return the mission with its (full) ambulance. */
export type MissionWithAmbulance = Mission & { ambulance: Ambulance | null };

export interface MissionListFilters {
  status?: string;
  q?: string;
  ambulanceId?: string;
  limit: number;
}

export interface MissionCreateData {
  requestRef: string;
  patientName: string;
  contact: string;
  emergencyType: string;
  priority: string;
  pickup: string;
  destination: string;
  status: string;
  route: string;
  etaMin: number;
}

export interface MissionUpdateData {
  status?: string;
  progress?: number;
  corridorActive?: boolean;
  ambulanceId?: string;
  vehiclesAlerted?: number;
  timeSavedSec?: number;
  etaMin?: number;
  route?: string;
}

export interface CorridorEventCreateData {
  missionId: string;
  segment: string;
  method: string;
  congestion: string;
  vehiclesAlerted: number;
  timeSavedSec: number;
  note: string;
}

export interface MissionRepository {
  listMissions(filters: MissionListFilters): Promise<MissionListRow[]>;
  countMissions(): Promise<number>;
  findMissionByRequestRef(requestRef: string): Promise<MissionRow | null>;
  findMissionById(id: string): Promise<MissionRow | null>;
  createMission(data: MissionCreateData): Promise<MissionRow>;
  /** Plain update — no relation include (legacy dispatch update shape). */
  updateMission(id: string, data: MissionUpdateData): Promise<MissionRow>;
  /** Update returning the mission with its full ambulance (legacy include). */
  updateMissionWithAmbulance(id: string, data: MissionUpdateData): Promise<MissionWithAmbulance>;
  findAmbulanceById(id: string): Promise<AmbulanceRow | null>;
  updateAmbulanceStatus(id: string, status: string): Promise<void>;
  createCorridorEvents(events: CorridorEventCreateData[]): Promise<void>;
  listCorridorEvents(missionId: string): Promise<CorridorEventRow[]>;
}
