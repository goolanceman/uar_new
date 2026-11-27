/**
 * Prisma implementation of the prescription repository — the ONLY place in
 * the prescriptions module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";
import { RX_INCLUDE } from "./prescription.repository.interface";
import type {
  DispenseCreateData,
  InventoryIssueData,
  PrescriptionCreateData,
  PrescriptionDetailRow,
  PrescriptionForDispenseRow,
  PrescriptionForPrintRow,
  PrescriptionForSignRow,
  PrescriptionListFilter,
  PrescriptionRepository,
  PrescriptionUpdateData,
  PrescriptionWithDoctorRow,
} from "./prescription.repository.interface";

export class PrismaPrescriptionRepository implements PrescriptionRepository {
  async list(
    filter: PrescriptionListFilter,
    skip: number,
    take: number
  ): Promise<{ items: PrescriptionDetailRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filter.beneficiaryId) where.beneficiaryId = filter.beneficiaryId;
    if (filter.campId) where.campId = filter.campId;
    if (filter.doctorId) where.doctorId = filter.doctorId;
    if (filter.status) where.status = filter.status;
    if (filter.code) where.code = filter.code;

    const [total, items] = await Promise.all([
      db.prescription.count({ where }),
      db.prescription.findMany({
        where,
        include: RX_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);
    return { items: items as PrescriptionDetailRow[], total };
  }

  async findBeneficiaryIdByUserId(userId: string) {
    return db.beneficiary.findUnique({
      where: { userId },
      select: { id: true },
    });
  }

  async findBeneficiaryLite(id: string) {
    return db.beneficiary.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
  }

  async findEncounterLite(id: string) {
    return db.encounter.findUnique({ where: { id }, select: { id: true } });
  }

  async findCampLite(id: string) {
    return db.medicalCamp.findUnique({ where: { id }, select: { id: true } });
  }

  async findProfessionalByUserId(userId: string) {
    return db.healthProfessional.findUnique({
      where: { userId },
      select: { id: true, name: true },
    });
  }

  async createWithItems(data: PrescriptionCreateData): Promise<PrescriptionDetailRow> {
    // FK-guarded: beneficiary/camp/encounter/doctor references could race a
    // concurrent delete; the nested item creates must land atomically with
    // the prescription row.
    return mapPrismaError(() =>
      db.prescription.create({
        data: {
          code: data.code,
          encounterId: data.encounterId,
          campId: data.campId,
          beneficiaryId: data.beneficiaryId,
          doctorId: data.doctorId,
          diagnosis: data.diagnosis,
          followUpDate: data.followUpDate,
          status: "DRAFT",
          items: { create: data.items },
        },
        include: RX_INCLUDE,
      })
    );
  }

  async findById(id: string) {
    return db.prescription.findUnique({ where: { id }, include: RX_INCLUDE });
  }

  async findWithDoctor(id: string): Promise<PrescriptionWithDoctorRow | null> {
    return db.prescription.findUnique({
      where: { id },
      include: { doctor: { select: { userId: true, name: true } } },
    });
  }

  async findForDispense(id: string): Promise<PrescriptionForDispenseRow | null> {
    return db.prescription.findUnique({
      where: { id },
      include: {
        items: true,
        dispenses: { select: { itemId: true, quantity: true } },
        doctor: { select: { name: true } },
        beneficiary: { select: { code: true, name: true } },
      },
    });
  }

  async findForSign(id: string): Promise<PrescriptionForSignRow | null> {
    return db.prescription.findUnique({
      where: { id },
      include: {
        doctor: { select: { userId: true, name: true } },
        items: { select: { id: true } },
      },
    });
  }

  async findForPrint(id: string): Promise<PrescriptionForPrintRow | null> {
    return db.prescription.findUnique({
      where: { id },
      include: {
        items: true,
        doctor: { select: { name: true, regNumber: true, speciality: true, kind: true } },
        beneficiary: { select: { code: true, name: true, age: true, gender: true } },
        camp: { select: { title: true, code: true, venue: true, city: true } },
      },
    });
  }

  async findInventoryItemLite(id: string) {
    return db.inventoryItem.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
  }

  async update(id: string, data: PrescriptionUpdateData): Promise<PrescriptionDetailRow> {
    return mapPrismaError(() =>
      db.prescription.update({
        where: { id },
        data,
        include: RX_INCLUDE,
      })
    );
  }

  async sign(id: string, data: { signedAt: Date; signedByName: string }): Promise<PrescriptionDetailRow> {
    return mapPrismaError(() =>
      db.prescription.update({
        where: { id },
        data: {
          status: "SIGNED",
          signedAt: data.signedAt,
          signedByName: data.signedByName,
        },
        include: RX_INCLUDE,
      })
    );
  }

  async decrementInventoryIfAvailable(
    inventoryItemId: string,
    quantity: number,
    client: DbClient
  ): Promise<number> {
    // Atomic guard: only decrement when the current quantity covers it.
    const upd = await client.inventoryItem.updateMany({
      where: { id: inventoryItemId, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });
    return upd.count;
  }

  async findInventoryItemName(id: string, client: DbClient) {
    return client.inventoryItem.findUnique({
      where: { id },
      select: { name: true },
    });
  }

  async createInventoryTransaction(data: InventoryIssueData, client: DbClient): Promise<void> {
    await client.inventoryTransaction.create({
      data: {
        itemId: data.itemId,
        campId: data.campId,
        type: "ISSUED",
        quantity: data.quantity,
        batchNo: data.batchNo,
        expiryDate: data.expiryDate,
        source: "INTERNAL",
        owner: "UAR",
        refType: "DISPENSE",
        refId: data.refId,
        notes: data.notes,
        handledByName: data.handledByName,
      },
    });
  }

  async createDispense(data: DispenseCreateData, client: DbClient): Promise<void> {
    await client.medicationDispense.create({ data });
  }

  async listItemQuantities(prescriptionId: string, client: DbClient) {
    return client.prescriptionItem.findMany({
      where: { prescriptionId },
      select: { id: true, quantity: true },
    });
  }

  async dispensedTotalsByItem(prescriptionId: string, client: DbClient) {
    return client.medicationDispense.groupBy({
      by: ["itemId"],
      _sum: { quantity: true },
      where: { prescriptionId },
    });
  }

  async updateStatusWithDetail(id: string, status: string, client: DbClient): Promise<PrescriptionDetailRow> {
    return mapPrismaError(() =>
      client.prescription.update({
        where: { id },
        data: { status },
        include: RX_INCLUDE,
      })
    );
  }
}
