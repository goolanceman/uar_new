/**
 * School coverage repository contract — the outreach registry.
 */
import type { SchoolCoverage } from "@prisma/client";

export interface SchoolCoverageData {
  schoolName: string;
  address: string | null;
  city: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  totalGirls: number;
  lastVisited: Date | null;
  isActive: boolean;
  visitsCount: number;
}

export interface SchoolCoverageListWhere {
  [key: string]: unknown;
}

export interface SchoolCoverageRepository {
  /** Active-first, schoolName asc, capped at 300 (legacy orderBy/take). */
  list(where: SchoolCoverageListWhere): Promise<SchoolCoverage[]>;
  findByName(schoolName: string): Promise<SchoolCoverage | null>;
  create(data: SchoolCoverageData): Promise<SchoolCoverage>;
  update(id: string, data: SchoolCoverageData): Promise<SchoolCoverage>;
}
