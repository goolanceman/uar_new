/**
 * Prisma implementation of the corridor event repository — the ONLY place in
 * the corridor-events module that touches Prisma models directly. (Read-only
 * list: no unique/FK violation risk, so no mapPrismaError wrap.)
 */
import { db } from "@/infrastructure/database/prisma";
import type {
  CorridorEventFilter,
  CorridorEventRepository,
  CorridorEventWithMission,
} from "./corridor-event.repository.interface";

export class PrismaCorridorEventRepository implements CorridorEventRepository {
  async list(filter: CorridorEventFilter): Promise<CorridorEventWithMission[]> {
    const events = await db.corridorEvent.findMany({
      where: {
        ...(filter.missionId ? { missionId: filter.missionId } : {}),
        ...(filter.method ? { method: filter.method } : {}),
        ...(filter.congestion ? { congestion: filter.congestion } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: filter.limit,
      include: { mission: { select: { requestRef: true } } },
    });
    return events as CorridorEventWithMission[];
  }
}
