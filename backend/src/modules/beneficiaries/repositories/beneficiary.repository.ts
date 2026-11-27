/**
 * Prisma implementation of the beneficiary repository — the ONLY place in the
 * beneficiaries module that touches Prisma models directly.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  BeneficiaryCreateData,
  BeneficiaryListFilters,
  BeneficiaryListRow,
  BeneficiaryNoteCreateData,
  BeneficiaryNoteRow,
  BeneficiaryRepository,
  BeneficiaryRow,
  BeneficiaryUpdateData,
  FileAssetSummary,
} from "./beneficiary.repository.interface";

export class PrismaBeneficiaryRepository implements BeneficiaryRepository {
  async findBeneficiaryByUserId(userId: string): Promise<BeneficiaryRow | null> {
    return db.beneficiary.findUnique({ where: { userId } });
  }

  async findBeneficiaryById(id: string): Promise<BeneficiaryRow | null> {
    return db.beneficiary.findUnique({ where: { id } });
  }

  /** Legacy where-builder (staff branch) — moved verbatim from the route. */
  private buildWhere(filters: BeneficiaryListFilters): Prisma.BeneficiaryWhereInput {
    const where: Prisma.BeneficiaryWhereInput = {};
    if (filters.caseStatus) where.caseStatus = filters.caseStatus.toUpperCase();
    if (filters.verificationStatus)
      where.verificationStatus = filters.verificationStatus.toUpperCase();
    if (filters.q)
      where.OR = [
        { name: { contains: filters.q, mode: "insensitive" } },
        { phone: { contains: filters.q, mode: "insensitive" } },
        { city: { contains: filters.q, mode: "insensitive" } },
        { code: { contains: filters.q, mode: "insensitive" } },
      ];
    if (filters.category) where.category = filters.category;
    if (filters.active === "0" || filters.active === "1")
      where.isActive = filters.active === "1";

    if (filters.hasRecurringNeeds === "1")
      where.recurringNeeds = { some: { status: "ACTIVE" } };
    else if (filters.hasRecurringNeeds === "0")
      where.recurringNeeds = { none: { status: "ACTIVE" } };

    return where;
  }

  /** Shared findMany args — orderBy newest first + active-needs count. */
  private findManyArgs(filters: BeneficiaryListFilters) {
    return {
      where: this.buildWhere(filters),
      orderBy: { createdAt: "desc" as const },
      include: { _count: { select: { recurringNeeds: { where: { status: "ACTIVE" } } } } },
    };
  }

  async listBeneficiaries(filters: BeneficiaryListFilters): Promise<BeneficiaryListRow[]> {
    const rows = await db.beneficiary.findMany(this.findManyArgs(filters));
    return rows as BeneficiaryListRow[];
  }

  async listBeneficiariesPaged(
    filters: BeneficiaryListFilters,
    skip: number,
    take: number
  ): Promise<{ rows: BeneficiaryListRow[]; total: number }> {
    const args = this.findManyArgs(filters);
    const [items, total] = await Promise.all([
      db.beneficiary.findMany({ ...args, skip, take }),
      db.beneficiary.count({ where: args.where }),
    ]);
    return { rows: items as BeneficiaryListRow[], total };
  }

  async createBeneficiary(data: BeneficiaryCreateData): Promise<BeneficiaryRow> {
    return mapPrismaError(() => db.beneficiary.create({ data }));
  }

  async updateBeneficiary(id: string, data: BeneficiaryUpdateData): Promise<BeneficiaryRow> {
    return db.beneficiary.update({
      where: { id },
      data: data as Prisma.BeneficiaryUpdateInput,
    });
  }

  async deleteBeneficiary(id: string): Promise<void> {
    await db.beneficiary.delete({ where: { id } });
  }

  async listNotes(beneficiaryId: string): Promise<BeneficiaryNoteRow[]> {
    return db.beneficiaryNote.findMany({
      where: { beneficiaryId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async createNote(data: BeneficiaryNoteCreateData): Promise<BeneficiaryNoteRow> {
    return mapPrismaError(() => db.beneficiaryNote.create({ data }));
  }

  async findFileAssetsByIds(ids: string[]): Promise<FileAssetSummary[]> {
    return db.fileAsset.findMany({
      where: { id: { in: ids } },
      select: { id: true, uploadedById: true, mime: true },
    });
  }
}
