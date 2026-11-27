/**
 * Prisma implementation of the vitals repository — the ONLY place in the
 * vitals module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  VitalObservationCreateData,
  VitalObservationRepository,
  VitalObservationRow,
  VitalsListFilters,
} from "./vitals.repository.interface";

export class PrismaVitalObservationRepository implements VitalObservationRepository {
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

  async create(data: VitalObservationCreateData): Promise<VitalObservationRow> {
    // FK-guarded: camp/encounter references could race a concurrent delete.
    return mapPrismaError(() =>
      db.vitalObservation.create({
        data,
        include: { beneficiary: { select: { id: true, code: true, name: true } } },
      })
    );
  }

  async list(
    filters: VitalsListFilters,
    skip: number,
    limit: number
  ): Promise<{ rows: VitalObservationRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filters.beneficiaryId) where.beneficiaryId = filters.beneficiaryId;
    if (filters.campId) where.campId = filters.campId;
    if (filters.encounterId) where.encounterId = filters.encounterId;

    const [total, rows] = await Promise.all([
      db.vitalObservation.count({ where }),
      db.vitalObservation.findMany({
        where,
        include: { beneficiary: { select: { id: true, code: true, name: true } } },
        orderBy: { recordedAt: "desc" },
        skip,
        take: limit,
      }),
    ]);
    return { rows: rows as VitalObservationRow[], total };
  }
}
