/**
 * Prisma implementation of the beneficiary-request repository — the ONLY
 * place in the beneficiary-requests module that touches Prisma models
 * directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  BeneficiaryRequestCreateData,
  BeneficiaryRequestRepository,
  BeneficiaryRequestRow,
  BeneficiaryRequestUpdateData,
  BeneficiaryRequestWithBeneficiary,
} from "./beneficiary-request.repository.interface";

export class PrismaBeneficiaryRequestRepository implements BeneficiaryRequestRepository {
  /** ?mine=1 — the caller's own requests, newest first (legacy take 100). */
  async findMine(userId: string): Promise<BeneficiaryRequestRow[]> {
    return db.beneficiaryRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /** Admin queue — newest first (legacy take 300) with the beneficiary
   *  header; the optional status filter is applied only when truthy. */
  async listAll(status?: string): Promise<BeneficiaryRequestWithBeneficiary[]> {
    const rows = await db.beneficiaryRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { beneficiary: { select: { id: true, name: true, city: true } } },
    });
    return rows as BeneficiaryRequestWithBeneficiary[];
  }

  async findById(id: string): Promise<BeneficiaryRequestRow | null> {
    return db.beneficiaryRequest.findUnique({ where: { id } });
  }

  /** Full-row lookup by the unique userId (legacy shape; only .id is used). */
  async findBeneficiaryByUserId(userId: string): Promise<{ id: string } | null> {
    return db.beneficiary.findUnique({ where: { userId } });
  }

  /** beneficiaryId is a client-supplied FK — wrapped per the unique/FK
   *  violation rule (a dangling id surfaces as a 409, not a raw Prisma 500). */
  async create(data: BeneficiaryRequestCreateData): Promise<BeneficiaryRequestRow> {
    return mapPrismaError(() => db.beneficiaryRequest.create({ data }));
  }

  /** Review-field update (no unique/FK fields are written) — wrapped like
   *  the wave-1 exemplars so a P2025 race renders as a 404, not a 500. */
  async update(id: string, data: BeneficiaryRequestUpdateData): Promise<BeneficiaryRequestRow> {
    return mapPrismaError(() => db.beneficiaryRequest.update({ where: { id }, data }));
  }

  /** Nothing references BeneficiaryRequest (no incoming FK) — plain delete,
   *  exactly like the wave-1 exemplars' deletes. */
  async delete(id: string): Promise<void> {
    await db.beneficiaryRequest.delete({ where: { id } });
  }
}
