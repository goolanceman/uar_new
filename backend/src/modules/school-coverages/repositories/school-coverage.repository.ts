/**
 * Prisma implementation of the school coverage repository — the ONLY place in
 * the school-coverages module that touches Prisma models directly. Create and
 * update are wrapped in mapPrismaError (constraint failures surface as app
 * errors instead of raw Prisma exceptions).
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { SchoolCoverage } from "@prisma/client";
import type {
  SchoolCoverageData,
  SchoolCoverageListWhere,
  SchoolCoverageRepository,
} from "./school-coverage.repository.interface";

export class PrismaSchoolCoverageRepository implements SchoolCoverageRepository {
  list(where: SchoolCoverageListWhere): Promise<SchoolCoverage[]> {
    return db.schoolCoverage.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { schoolName: "asc" }],
      take: 300,
    });
  }

  findByName(schoolName: string): Promise<SchoolCoverage | null> {
    return db.schoolCoverage.findFirst({ where: { schoolName } });
  }

  create(data: SchoolCoverageData): Promise<SchoolCoverage> {
    return mapPrismaError(() => db.schoolCoverage.create({ data }));
  }

  update(id: string, data: SchoolCoverageData): Promise<SchoolCoverage> {
    return mapPrismaError(() => db.schoolCoverage.update({ where: { id }, data }));
  }
}
