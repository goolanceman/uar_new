/**
 * Prisma implementation of the certificate repository — the ONLY place in the
 * certificates module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CertificateListScope,
  CertificateRepository,
  CertificateRow,
  CreateCertificateData,
} from "./certificate.repository.interface";

export class PrismaCertificateRepository implements CertificateRepository {
  async count(): Promise<number> {
    return db.certificate.count();
  }

  async findByCode(code: string): Promise<CertificateRow | null> {
    return db.certificate.findUnique({ where: { code } });
  }

  async list(scope: CertificateListScope, limit: number): Promise<CertificateRow[]> {
    return db.certificate.findMany({
      where: scope.userId ? { userId: scope.userId } : {},
      orderBy: { issuedAt: "desc" },
      take: limit,
    });
  }

  async findUserById(id: string): Promise<{ id: string } | null> {
    return db.user.findUnique({ where: { id }, select: { id: true } });
  }

  /** code is unique — a concurrent issue maps to a 409 instead of a raw 500. */
  async create(data: CreateCertificateData): Promise<CertificateRow> {
    return mapPrismaError(() => db.certificate.create({ data }));
  }
}
