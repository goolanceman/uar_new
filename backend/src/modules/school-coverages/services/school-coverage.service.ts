/**
 * School coverage service — the outreach registry. The list mirrors the
 * legacy where/orderBy/take exactly; the upsert semantics are the legacy
 * ones: an existing schoolName bumps visitsCount (+1), a new row starts at 1
 * when lastVisited was provided, else 0. The activity log entry is written
 * AFTER the row write (SCHOOL_CREATE / SCHOOL_UPDATE) with the acting
 * session's name.
 */
import { logActivity, type Session } from "@/infrastructure/auth/session";
import type { SchoolCoverage } from "@prisma/client";
import type { CreateSchoolCoverageBody } from "../schemas/school-coverage.schema";
import type {
  SchoolCoverageData,
  SchoolCoverageRepository,
} from "../repositories/school-coverage.repository.interface";

export interface SchoolCoverageUpsertResult {
  row: SchoolCoverage;
  isUpdate: boolean;
}

export class SchoolCoverageService {
  constructor(private readonly schoolCoverageRepository: SchoolCoverageRepository) {}

  /** GET /api/school-coverages?q=&active=1 — active-first, schoolName asc. */
  async list(query: { q?: string; active: boolean }): Promise<SchoolCoverage[]> {
    const where: Record<string, unknown> = {};
    if (query.active) where.isActive = true;
    if (query.q) where.schoolName = { contains: query.q };

    return this.schoolCoverageRepository.list(where);
  }

  /** POST /api/school-coverages — register/upsert a school in the registry. */
  async upsert(body: CreateSchoolCoverageBody, actor: Session): Promise<SchoolCoverageUpsertResult> {
    const existing = await this.schoolCoverageRepository.findByName(body.schoolName);

    const data: SchoolCoverageData = {
      schoolName: body.schoolName,
      address: body.address,
      city: body.city,
      contactPerson: body.contactPerson,
      contactPhone: body.contactPhone,
      totalGirls: Math.round(body.totalGirls),
      // Legacy: `body?.lastVisited ? new Date(String(body.lastVisited)) : null`
      // — an unparseable value becomes Invalid Date and fails in Prisma (500),
      // exactly like the legacy route.
      lastVisited: body.lastVisited ? new Date(String(body.lastVisited)) : null,
      isActive: body.isActive,
      visitsCount: existing ? existing.visitsCount + 1 : body.lastVisited ? 1 : 0,
    };

    const row = existing
      ? await this.schoolCoverageRepository.update(existing.id, data)
      : await this.schoolCoverageRepository.create(data);

    await logActivity(
      actor.name,
      existing ? "SCHOOL_UPDATE" : "SCHOOL_CREATE",
      "SCHOOL",
      body.schoolName,
      actor.userId
    );
    return { row, isUpdate: Boolean(existing) };
  }
}
