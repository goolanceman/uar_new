/**
 * Prisma implementation of the encounter repository — the ONLY place in the
 * encounters module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import {
  ENCOUNTER_DETAIL_INCLUDE,
  ENCOUNTER_FULL_DETAIL_INCLUDE,
  ENCOUNTER_LIST_INCLUDE,
  ENCOUNTER_SIGN_INCLUDE,
} from "./encounter.repository.interface";
import type {
  EncounterCreateData,
  EncounterListFilter,
  EncounterListRow,
  EncounterRepository,
  EncounterUpdateData,
} from "./encounter.repository.interface";

export class PrismaEncounterRepository implements EncounterRepository {
  async list(filter: EncounterListFilter, skip: number, take: number) {
    const where: Record<string, unknown> = {};
    if (filter.beneficiaryId) where.beneficiaryId = filter.beneficiaryId;
    if (filter.campId) where.campId = filter.campId;
    if (filter.doctorId) where.doctorId = filter.doctorId;
    if (filter.status) where.status = filter.status;
    if (filter.createdAt && (filter.createdAt.gte || filter.createdAt.lte))
      where.createdAt = filter.createdAt;

    const [total, items] = await Promise.all([
      db.encounter.count({ where }),
      db.encounter.findMany({
        where,
        include: ENCOUNTER_LIST_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);
    return { items: items as EncounterListRow[], total };
  }

  async findBeneficiaryLite(id: string) {
    return db.beneficiary.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
  }

  async findCampLite(id: string) {
    return db.medicalCamp.findUnique({ where: { id }, select: { id: true } });
  }

  async findProfessionalByUserId(userId: string) {
    return db.healthProfessional.findUnique({
      where: { userId },
      select: { id: true, name: true, kind: true },
    });
  }

  async create(data: EncounterCreateData) {
    // FK-guarded: camp/registration references could race a concurrent delete.
    return mapPrismaError(() =>
      db.encounter.create({
        data: {
          campId: data.campId,
          registrationId: data.registrationId,
          beneficiaryId: data.beneficiaryId,
          doctorId: data.doctorId,
          status: "DRAFT",
          chiefComplaint: data.chiefComplaint,
          observations: data.observations,
          diagnosis: data.diagnosis,
          advice: data.advice,
          followUpDate: data.followUpDate,
        },
        include: ENCOUNTER_LIST_INCLUDE,
      })
    );
  }

  async findDetailById(id: string) {
    return db.encounter.findUnique({
      where: { id },
      include: ENCOUNTER_FULL_DETAIL_INCLUDE,
    });
  }

  async findBeneficiaryIdByUserId(userId: string) {
    return db.beneficiary.findUnique({
      where: { userId },
      select: { id: true },
    });
  }

  async findWithDoctor(id: string) {
    return db.encounter.findUnique({
      where: { id },
      include: { doctor: { select: { id: true, userId: true, name: true } } },
    });
  }

  async updateWithDetail(id: string, data: EncounterUpdateData) {
    return mapPrismaError(() =>
      db.encounter.update({
        where: { id },
        data,
        include: ENCOUNTER_DETAIL_INCLUDE,
      })
    );
  }

  async findWithDoctorForSign(id: string) {
    return db.encounter.findUnique({
      where: { id },
      include: { doctor: { select: { userId: true, name: true } } },
    });
  }

  async sign(id: string, data: { status: string; signedAt: Date; signedByName: string }) {
    return mapPrismaError(() =>
      db.encounter.update({
        where: { id },
        data: {
          status: data.status,
          signedAt: data.signedAt,
          signedByName: data.signedByName,
        },
        include: ENCOUNTER_SIGN_INCLUDE,
      })
    );
  }
}
