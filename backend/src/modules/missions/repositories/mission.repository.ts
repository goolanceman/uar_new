/**
 * Prisma implementation of the mission repository — the ONLY place in the
 * missions module that touches Prisma models directly.
 *
 * The legacy flows had NO transaction boundaries (sequential awaited writes:
 * mission update, then ambulance flip, then event creation) — that exact
 * order and non-atomicity is preserved here.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  AmbulanceRow,
  CorridorEventCreateData,
  CorridorEventRow,
  MissionCreateData,
  MissionListFilters,
  MissionListRow,
  MissionRepository,
  MissionRow,
  MissionUpdateData,
  MissionWithAmbulance,
} from "./mission.repository.interface";

export class PrismaMissionRepository implements MissionRepository {
  async listMissions(filters: MissionListFilters): Promise<MissionListRow[]> {
    const where: Prisma.MissionWhereInput = {};
    if (filters.ambulanceId) where.ambulanceId = filters.ambulanceId;
    if (filters.status) where.status = filters.status;
    if (filters.q)
      where.OR = [
        { requestRef: { contains: filters.q } },
        { patientName: { contains: filters.q } },
        { pickup: { contains: filters.q } },
      ];

    const missions = await db.mission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.limit,
      include: {
        ambulance: { select: { code: true, type: true, driverName: true } },
      },
    });
    return missions as MissionListRow[];
  }

  async countMissions(): Promise<number> {
    return db.mission.count();
  }

  async findMissionByRequestRef(requestRef: string): Promise<MissionRow | null> {
    return db.mission.findUnique({ where: { requestRef } });
  }

  async findMissionById(id: string): Promise<MissionRow | null> {
    return db.mission.findUnique({ where: { id } });
  }

  /** requestRef is unique — a lost race with the pre-check loop renders as 409. */
  async createMission(data: MissionCreateData): Promise<MissionRow> {
    return mapPrismaError(() => db.mission.create({ data }));
  }

  async updateMission(id: string, data: MissionUpdateData): Promise<MissionRow> {
    return mapPrismaError(() =>
      db.mission.update({ where: { id }, data: data as Prisma.MissionUncheckedUpdateInput })
    );
  }

  async updateMissionWithAmbulance(id: string, data: MissionUpdateData): Promise<MissionWithAmbulance> {
    return mapPrismaError(() =>
      db.mission.update({
        where: { id },
        data: data as Prisma.MissionUncheckedUpdateInput,
        include: { ambulance: true },
      })
    );
  }

  async findAmbulanceById(id: string): Promise<AmbulanceRow | null> {
    return db.ambulance.findUnique({ where: { id } });
  }

  async updateAmbulanceStatus(id: string, status: string): Promise<void> {
    await db.ambulance.update({ where: { id }, data: { status } });
  }

  /** missionId is an FK — constraint failures render as conflicts. */
  async createCorridorEvents(events: CorridorEventCreateData[]): Promise<void> {
    await mapPrismaError(() => db.corridorEvent.createMany({ data: events }));
  }

  async listCorridorEvents(missionId: string): Promise<CorridorEventRow[]> {
    return db.corridorEvent.findMany({
      where: { missionId },
      orderBy: { createdAt: "desc" },
    });
  }
}
