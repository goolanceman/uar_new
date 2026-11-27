/**
 * Prisma implementation of the appointment repository — the ONLY place in the
 * appointments module that touches Prisma models directly. Include/select
 * shapes match the legacy handlers exactly so the wire format is
 * byte-identical.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  AppointmentListPage,
  AppointmentListScope,
  AppointmentRepository,
  CreateAppointmentData,
  UpdateAppointmentData,
} from "./appointment.repository.interface";

const LIST_INCLUDE = {
  beneficiary: { select: { id: true, code: true, name: true, phone: true } },
  professional: { select: { id: true, name: true, kind: true, speciality: true } },
  camp: { select: { id: true, code: true, title: true } },
} as const;

const CREATE_INCLUDE = {
  beneficiary: { select: { id: true, code: true, name: true, phone: true } },
  professional: { select: { id: true, name: true, kind: true, speciality: true } },
} as const;

const DETAIL_INCLUDE = {
  beneficiary: {
    select: { id: true, code: true, name: true, phone: true, age: true, gender: true },
  },
  professional: { select: { id: true, name: true, kind: true, speciality: true } },
  camp: { select: { id: true, code: true, title: true, status: true } },
} as const;

export class PrismaAppointmentRepository implements AppointmentRepository {
  async findBeneficiaryByUser(userId: string): Promise<{ id: string } | null> {
    return db.beneficiary.findUnique({ where: { userId }, select: { id: true } });
  }

  async findBeneficiaryById(id: string): Promise<{ id: string; name: string } | null> {
    return db.beneficiary.findUnique({ where: { id } });
  }

  async findCampById(id: string): Promise<{ id: string } | null> {
    return db.medicalCamp.findUnique({ where: { id } });
  }

  async findProfessionalById(id: string): Promise<{ id: string } | null> {
    return db.healthProfessional.findUnique({ where: { id } });
  }

  async findProfessionalByUser(userId: string): Promise<{ id: string } | null> {
    return db.healthProfessional.findUnique({ where: { userId } });
  }

  async list(scope: AppointmentListScope, skip: number, take: number): Promise<AppointmentListPage> {
    const where: Record<string, unknown> = {};
    if (scope.campId) where.campId = scope.campId;
    if (scope.beneficiaryId) where.beneficiaryId = scope.beneficiaryId;
    if (scope.professionalId) where.professionalId = scope.professionalId;
    if (scope.type) where.type = scope.type;
    if (scope.status) where.status = scope.status;
    if (scope.scheduledAt) where.scheduledAt = scope.scheduledAt;

    const [items, total] = await Promise.all([
      db.appointment.findMany({
        where,
        orderBy: { scheduledAt: "desc" },
        skip,
        take,
        include: LIST_INCLUDE,
      }),
      db.appointment.count({ where }),
    ]);
    return { items, total };
  }

  async findById(
    id: string
  ): Promise<{ id: string; status: string; type: string; beneficiaryId: string } | null> {
    return db.appointment.findUnique({ where: { id } });
  }

  async findByIdWithDetail(id: string): Promise<unknown | null> {
    return db.appointment.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  /** FK-guarded: camp/beneficiary/professional references could race a
   *  concurrent delete. */
  async create(data: CreateAppointmentData): Promise<unknown> {
    return mapPrismaError(() =>
      db.appointment.create({ data, include: CREATE_INCLUDE })
    );
  }

  async update(
    id: string,
    data: UpdateAppointmentData
  ): Promise<{ id: string; status: string; noShowReason: string | null }> {
    return mapPrismaError(() => db.appointment.update({ where: { id }, data }));
  }

  async delete(id: string): Promise<void> {
    await db.appointment.delete({ where: { id } });
  }
}
