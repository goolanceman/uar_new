/**
 * Prisma implementation of the food programme repository — the ONLY place in
 * the food module that touches FoodProgramme models directly (plus the
 * linked-campaign lookup shared with the event desk). Legacy query shapes
 * are reproduced verbatim.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  FoodProgrammeRepository,
  ProgrammeCreateData,
  ProgrammeDetailRow,
  ProgrammeListRow,
  ProgrammeUpdateData,
} from "./food-programme.repository.interface";

export class PrismaFoodProgrammeRepository implements FoodProgrammeRepository {
  async listPublicProgrammes() {
    return db.foodProgramme.findMany({
      where: { publicVisible: true, status: { in: ["PUBLISHED", "ACTIVE"] } },
      orderBy: [{ startDate: "desc" }],
    });
  }

  async listProgrammes(status?: string | null): Promise<ProgrammeListRow[]> {
    const rows = await db.foodProgramme.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        campaign: { select: { id: true, title: true } },
        _count: { select: { events: true } },
      },
    });
    return rows as ProgrammeListRow[];
  }

  async findProgrammeById(id: string) {
    return db.foodProgramme.findUnique({ where: { id } });
  }

  async findCampaignById(id: string) {
    return db.campaign.findUnique({ where: { id } });
  }

  async createProgramme(data: ProgrammeCreateData) {
    return mapPrismaError(() => db.foodProgramme.create({ data }));
  }

  async findProgrammeDetail(id: string): Promise<ProgrammeDetailRow | null> {
    const row = await db.foodProgramme.findUnique({
      where: { id },
      include: {
        campaign: { select: { id: true, title: true } },
        events: {
          orderBy: { eventDate: "desc" },
          include: { _count: { select: { registrations: true } } },
        },
      },
    });
    return row as ProgrammeDetailRow | null;
  }

  async updateProgramme(id: string, data: ProgrammeUpdateData) {
    return mapPrismaError(() =>
      db.foodProgramme.update({
        where: { id },
        data: data as import("@prisma/client").Prisma.FoodProgrammeUncheckedUpdateInput,
      })
    );
  }
}
