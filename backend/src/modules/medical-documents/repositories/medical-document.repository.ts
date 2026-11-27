/**
 * Prisma implementation of the medical document repository — the ONLY place
 * in the medical-documents module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  MedicalDocumentCreateData,
  MedicalDocumentDeleteRow,
  MedicalDocumentListWhere,
  MedicalDocumentRepository,
  MedicalDocumentRow,
} from "./medical-document.repository.interface";

export class PrismaMedicalDocumentRepository implements MedicalDocumentRepository {
  async findBeneficiaryIdByUserId(userId: string): Promise<string | null> {
    const own = await db.beneficiary.findUnique({
      where: { userId },
      select: { id: true },
    });
    return own?.id ?? null;
  }

  async findBeneficiaryRef(id: string): Promise<{ id: string; code: string } | null> {
    return db.beneficiary.findUnique({ where: { id }, select: { id: true, code: true } });
  }

  async findCampRef(id: string): Promise<{ id: string } | null> {
    return db.medicalCamp.findUnique({ where: { id }, select: { id: true } });
  }

  async countDocuments(where: MedicalDocumentListWhere): Promise<number> {
    return db.medicalDocument.count({ where });
  }

  async listDocuments(
    where: MedicalDocumentListWhere,
    skip: number,
    take: number
  ): Promise<MedicalDocumentRow[]> {
    return db.medicalDocument.findMany({
      where,
      include: {
        beneficiary: { select: { id: true, code: true, name: true } },
        camp: { select: { id: true, code: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async findDocumentById(id: string): Promise<MedicalDocumentRow | null> {
    return db.medicalDocument.findUnique({
      where: { id },
      include: {
        beneficiary: { select: { id: true, code: true, name: true } },
        camp: { select: { id: true, code: true, title: true } },
      },
    });
  }

  async findDocumentForDelete(id: string): Promise<MedicalDocumentDeleteRow | null> {
    return db.medicalDocument.findUnique({
      where: { id },
      include: { beneficiary: { select: { code: true } } },
    });
  }

  async createDocument(data: MedicalDocumentCreateData): Promise<MedicalDocumentRow> {
    return mapPrismaError(() =>
      db.medicalDocument.create({
        data,
        include: {
          beneficiary: { select: { id: true, code: true, name: true } },
          camp: { select: { id: true, code: true, title: true } },
        },
      })
    );
  }

  async deleteDocument(id: string): Promise<void> {
    await db.medicalDocument.delete({ where: { id } });
  }
}
