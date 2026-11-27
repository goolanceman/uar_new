/**
 * Prisma implementation of the health AI repository — the ONLY place in the
 * health-ai module that touches Prisma models directly.
 */
import { Prisma, type AIInteraction } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import type {
  CampStats,
  HealthAiRepository,
  InteractionCreateData,
  InteractionFilter,
  TimelineCounts,
} from "./health-ai.repository.interface";

export class PrismaHealthAiRepository implements HealthAiRepository {
  async listInteractions(
    filter: InteractionFilter,
    skip: number,
    limit: number
  ): Promise<{ total: number; items: AIInteraction[] }> {
    const where: Record<string, unknown> = {};
    if (filter.action) where.action = filter.action;
    if (filter.status) where.status = filter.status;

    const [total, items] = await Promise.all([
      db.aIInteraction.count({ where }),
      db.aIInteraction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);
    return { total, items };
  }

  async findBeneficiaryForConsult(id: string) {
    return db.beneficiary.findUnique({
      where: { id },
      select: { code: true, name: true, age: true, gender: true },
    });
  }

  async findEncounterId(id: string) {
    return db.encounter.findUnique({ where: { id }, select: { id: true } });
  }

  async setEncounterAiDraftUsed(id: string): Promise<void> {
    await db.encounter.update({ where: { id }, data: { aiDraftUsed: true } });
  }

  async findBeneficiaryForTimeline(id: string) {
    return db.beneficiary.findUnique({
      where: { id },
      select: { id: true, code: true },
    });
  }

  /** The legacy Promise.all counter batch — seven parallel counts. */
  async timelineCounts(beneficiaryId: string): Promise<TimelineCounts> {
    const [encounters, vitals, screenings, rx, labsPending, referralsOpen, followUpsPending] =
      await Promise.all([
        db.encounter.count({ where: { beneficiaryId } }),
        db.vitalObservation.count({ where: { beneficiaryId } }),
        db.screeningRecord.count({ where: { beneficiaryId } }),
        db.prescription.count({ where: { beneficiaryId } }),
        db.diagnosticOrder.count({
          where: { beneficiaryId, status: { notIn: ["DOCTOR_REVIEWED", "CANCELLED"] } },
        }),
        db.medicalReferral.count({
          where: { beneficiaryId, status: { notIn: ["COMPLETED", "CANCELLED", "LOST_TO_FOLLOWUP"] } },
        }),
        db.followUp.count({ where: { beneficiaryId, status: "PENDING" } }),
      ]);
    return { encounters, vitals, screenings, rx, labsPending, referralsOpen, followUpsPending };
  }

  /** The legacy Promise.all aggregate batch for camp planning. */
  async campStats(city: string | null): Promise<CampStats> {
    const campWhere: Prisma.MedicalCampWhereInput = city ? { city: { contains: city } } : {};
    const attendanceWhere: Prisma.CampAttendanceWhereInput = city
      ? { camp: { city: { contains: city } } }
      : {};

    const [totalCamps, byStatus, attendanceTotal, noShows, topCities] = await Promise.all([
      db.medicalCamp.count({ where: campWhere }),
      db.medicalCamp.groupBy({
        by: ["status"],
        _count: true,
        where: campWhere,
      }),
      db.campAttendance.count({ where: attendanceWhere }),
      db.campAttendance.count({
        where: { status: "NO_SHOW", ...attendanceWhere },
      }),
      db.medicalCamp.groupBy({
        by: ["city"],
        _count: true,
        where: city ? campWhere : { city: { not: null } },
        orderBy: { _count: { city: "desc" } },
        take: 5,
      }),
    ]);

    return {
      totalCamps,
      byStatus: byStatus.map((s) => ({ status: s.status, _count: s._count })),
      attendanceTotal,
      noShows,
      topCities: topCities.map((c) => ({ city: c.city, _count: c._count })),
    };
  }

  async findMedicalDocument(id: string) {
    return db.medicalDocument.findUnique({ where: { id } });
  }

  async createInteraction(data: InteractionCreateData) {
    return db.aIInteraction.create({
      data: {
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        promptDigest: data.promptDigest,
        outputDigest: data.outputDigest,
        ...(data.confidence !== undefined ? { confidence: data.confidence } : {}),
        status: data.status,
        userId: data.userId,
      },
    });
  }

  async findInteractionById(id: string) {
    return db.aIInteraction.findUnique({ where: { id } });
  }

  async updateInteraction(id: string, data: { status: string; reviewedByName: string }) {
    return db.aIInteraction.update({ where: { id }, data });
  }
}
