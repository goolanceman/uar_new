/**
 * Prisma implementation of the lab order repository — the ONLY place in the
 * lab-orders module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  LabOrderCreateData,
  LabOrderExisting,
  LabOrderListFilter,
  LabOrderRepository,
  LabOrderRow,
} from "./lab-order.repository.interface";

/** Legacy ORDER_INCLUDE — reference selects shared by list/create/update. */
const ORDER_INCLUDE = {
  beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
  camp: { select: { id: true, code: true, title: true } },
  encounter: { select: { id: true, status: true, diagnosis: true } },
};

export class PrismaLabOrderRepository implements LabOrderRepository {
  async findBeneficiaryIdByUserId(userId: string): Promise<{ id: string } | null> {
    return db.beneficiary.findUnique({
      where: { userId },
      select: { id: true },
    });
  }

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

  async createOrder(data: LabOrderCreateData): Promise<LabOrderRow> {
    // FK/unique-guarded: camp/encounter references could race a concurrent
    // delete and the generated code could race a concurrent create.
    return mapPrismaError(() =>
      db.diagnosticOrder.create({
        data: {
          code: data.code,
          beneficiaryId: data.beneficiaryId,
          campId: data.campId,
          encounterId: data.encounterId,
          testName: data.testName,
          status: "ORDERED",
          orderedByName: data.orderedByName,
        },
        include: ORDER_INCLUDE,
      })
    );
  }

  async list(
    filter: LabOrderListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: LabOrderRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filter.beneficiaryId) where.beneficiaryId = filter.beneficiaryId;
    if (filter.campId) where.campId = filter.campId;
    if (filter.status) where.status = filter.status;
    if (filter.q) where.OR = [{ code: { contains: filter.q } }, { testName: { contains: filter.q } }];

    const [total, rows] = await Promise.all([
      db.diagnosticOrder.count({ where }),
      db.diagnosticOrder.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);
    return { rows: rows as LabOrderRow[], total };
  }

  async findById(id: string): Promise<LabOrderExisting | null> {
    return db.diagnosticOrder.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        testName: true,
        status: true,
        resultText: true,
        resultFileUrl: true,
      },
    });
  }

  async findByIdWithInclude(id: string): Promise<LabOrderRow | null> {
    const order = await db.diagnosticOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    return (order as LabOrderRow) ?? null;
  }

  async updateOrder(id: string, data: Record<string, unknown>): Promise<LabOrderRow> {
    return mapPrismaError(() =>
      db.diagnosticOrder.update({ where: { id }, data, include: ORDER_INCLUDE })
    );
  }
}
