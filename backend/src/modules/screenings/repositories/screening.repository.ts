/**
 * Prisma implementation of the screening repository — the ONLY place in the
 * screenings module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  ScreeningCreatedRow,
  ScreeningListFilters,
  ScreeningRecordRow,
  ScreeningRepository,
} from "./screening.repository.interface";

export class PrismaScreeningRepository implements ScreeningRepository {
  async findBeneficiaryRef(id: string): Promise<{ id: string; code: string } | null> {
    return db.beneficiary.findUnique({
      where: { id },
      select: { id: true, code: true },
    });
  }

  async findCampRef(id: string): Promise<{ id: string } | null> {
    return db.medicalCamp.findUnique({ where: { id }, select: { id: true } });
  }

  async findEncounterRef(id: string): Promise<{ id: string } | null> {
    return db.encounter.findUnique({ where: { id }, select: { id: true } });
  }

  async create(data: {
    beneficiaryId: string;
    campId: string | null;
    encounterId: string | null;
    type: string;
    result: string;
    abnormal: boolean;
    recordedByName: string;
  }): Promise<ScreeningCreatedRow> {
    // FK-guarded: camp/encounter references could race a concurrent delete.
    return mapPrismaError(() =>
      db.screeningRecord.create({
        data,
        include: { beneficiary: { select: { id: true, code: true, name: true } } },
      })
    );
  }

  async list(
    filters: ScreeningListFilters,
    skip: number,
    limit: number
  ): Promise<{ rows: ScreeningRecordRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filters.beneficiaryId) where.beneficiaryId = filters.beneficiaryId;
    if (filters.campId) where.campId = filters.campId;
    if (filters.encounterId) where.encounterId = filters.encounterId;
    if (filters.type) where.type = filters.type;
    if (filters.abnormal !== undefined) where.abnormal = filters.abnormal;

    const [total, rows] = await Promise.all([
      db.screeningRecord.count({ where }),
      db.screeningRecord.findMany({
        where,
        include: {
          beneficiary: { select: { id: true, code: true, name: true } },
          camp: { select: { id: true, code: true, title: true } },
        },
        orderBy: { recordedAt: "desc" },
        skip,
        take: limit,
      }),
    ]);
    return { rows: rows as ScreeningRecordRow[], total };
  }
}
