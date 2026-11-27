/**
 * Prisma implementation of the medical camp repository — the ONLY place in
 * the medical-camps module that touches Prisma models directly.
 */
import type { Campaign, MedicalCamp } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CampCounts,
  CampCreateData,
  CampDetailRow,
  CampListFilter,
  CampListRow,
  CampCountAgg,
  MedicalCampRepository,
  MedicalCampUpdatePatch,
} from "./medical-camp.repository.interface";

export class PrismaMedicalCampRepository implements MedicalCampRepository {
  async listWithCount(
    filter: CampListFilter,
    skip: number,
    take: number,
    upcoming: boolean
  ): Promise<{ rows: CampListRow[]; total: number }> {
    // Where-clause built in the legacy assignment order (requestedStatus →
    // anonymous public-status clamp → city → campaignId → upcoming override →
    // q search).
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.anonymous) {
      // Anonymous: clamp to publicly visible statuses.
      const PUBLIC_STATUSES = ["SCHEDULED", "LIVE", "COMPLETED"];
      if (!filter.status || !PUBLIC_STATUSES.includes(filter.status))
        where.status = { in: PUBLIC_STATUSES };
    }
    if (filter.city) where.city = filter.city;
    if (filter.campaignId) where.campaignId = filter.campaignId;
    if (filter.upcoming) {
      where.campDate = { gte: new Date() };
      where.status = { in: ["SCHEDULED", "LIVE"] };
    }
    if (filter.q)
      where.OR = [
        { title: { contains: filter.q } },
        { code: { contains: filter.q } },
        { venue: { contains: filter.q } },
        { city: { contains: filter.q } },
      ];

    const [camps, total] = await Promise.all([
      db.medicalCamp.findMany({
        where,
        orderBy: upcoming ? { campDate: "asc" } : { campDate: "desc" },
        skip,
        take,
        include: {
          campaign: { select: { id: true, title: true, slug: true, accent: true, icon: true } },
          _count: { select: { registrations: true } },
        },
      }),
      db.medicalCamp.count({ where }),
    ]);
    return { rows: camps as CampListRow[], total };
  }

  async attendanceCounts(ids: string[]): Promise<{ checkedIn: CampCountAgg[]; completed: CampCountAgg[] }> {
    const [checkedInAgg, completedAgg] = await Promise.all([
      db.campAttendance.groupBy({
        by: ["campId"],
        where: { campId: { in: ids }, checkInAt: { not: null } },
        _count: { _all: true },
      }),
      db.campAttendance.groupBy({
        by: ["campId"],
        where: { campId: { in: ids }, status: "COMPLETED" },
        _count: { _all: true },
      }),
    ]);
    return {
      checkedIn: checkedInAgg.map((r) => ({ campId: r.campId, total: r._count._all })),
      completed: completedAgg.map((r) => ({ campId: r.campId, total: r._count._all })),
    };
  }

  async findDetailById(id: string): Promise<CampDetailRow | null> {
    return db.medicalCamp.findUnique({
      where: { id },
      include: {
        campaign: { select: { id: true, title: true, slug: true, accent: true, icon: true } },
        campPartners: {
          include: { org: { select: { id: true, name: true, type: true, city: true, status: true } } },
        },
        campStaff: {
          include: {
            professional: { select: { id: true, name: true, kind: true, speciality: true } },
          },
        },
      },
    }) as Promise<CampDetailRow | null>;
  }

  async countsForCamp(id: string): Promise<CampCounts> {
    const [registrations, checkedIn, completed] = await Promise.all([
      db.campRegistration.count({ where: { campId: id } }),
      db.campAttendance.count({ where: { campId: id, checkInAt: { not: null } } }),
      db.campAttendance.count({ where: { campId: id, status: "COMPLETED" } }),
    ]);
    return { registrations, checkedIn, completed };
  }

  async findCampaignById(id: string): Promise<Campaign | null> {
    return db.campaign.findUnique({ where: { id } });
  }

  async create(data: CampCreateData): Promise<MedicalCamp> {
    // FK-guarded: the campaign reference could race a concurrent delete.
    return mapPrismaError(() =>
      db.medicalCamp.create({
        data: {
          code: data.code,
          title: data.title,
          description: data.description,
          campaignId: data.campaignId,
          campDate: data.campDate,
          startTime: data.startTime,
          endTime: data.endTime,
          venue: data.venue,
          city: data.city,
          capacity: data.capacity,
          expectedCount: data.expectedCount,
          services: data.services,
          status: "DRAFT",
          coordinatorName: data.coordinatorName,
          budget: data.budget,
          notes: data.notes,
          createdByName: data.createdByName,
        },
      })
    );
  }

  async findById(id: string): Promise<MedicalCamp | null> {
    return db.medicalCamp.findUnique({ where: { id } });
  }

  async update(id: string, patch: MedicalCampUpdatePatch): Promise<MedicalCamp> {
    return mapPrismaError(() => db.medicalCamp.update({ where: { id }, data: patch }));
  }

  async findWithRegistrationCount(
    id: string
  ): Promise<(MedicalCamp & { _count: { registrations: number } }) | null> {
    return db.medicalCamp.findUnique({
      where: { id },
      include: { _count: { select: { registrations: true } } },
    });
  }

  async delete(id: string): Promise<void> {
    // partners + staff cascade
    await mapPrismaError(() => db.medicalCamp.delete({ where: { id } }));
  }
}
