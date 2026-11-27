/**
 * Prisma implementation of the ambulance repository — the ONLY place in the
 * ambulances module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { AmbulanceListFilter, AmbulanceRepository, AmbulanceRow } from "./ambulance.repository.interface";

export class PrismaAmbulanceRepository implements AmbulanceRepository {
  async list(filter: AmbulanceListFilter): Promise<AmbulanceRow[]> {
    const where: {
      status?: string;
      type?: string;
      OR?: Array<{ code: { contains: string } } | { base: { contains: string } } | { driverName: { contains: string } }>;
    } = {};
    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    if (filter.q)
      where.OR = [{ code: { contains: filter.q } }, { base: { contains: filter.q } }, { driverName: { contains: filter.q } }];

    return db.ambulance.findMany({ where, orderBy: { code: "asc" } }) as Promise<AmbulanceRow[]>;
  }

  async findByCode(code: string): Promise<AmbulanceRow | null> {
    return (db.ambulance.findUnique({ where: { code } }) as Promise<AmbulanceRow>) ?? null;
  }

  async findById(id: string): Promise<AmbulanceRow | null> {
    return (db.ambulance.findUnique({ where: { id } }) as Promise<AmbulanceRow>) ?? null;
  }

  async createAmbulance(data: {
    code: string;
    type: string;
    status: string;
    base: string;
    driverName: string;
    driverPhone: string | null;
    crew: string | null;
    equipment: string | null;
  }): Promise<AmbulanceRow> {
    // code is unique — a race past the service's clash check maps to the
    // shared 409 conflict instead of leaking a raw Prisma error.
    return mapPrismaError(() => db.ambulance.create({ data }) as Promise<AmbulanceRow>);
  }

  async updateAmbulance(
    id: string,
    data: Partial<{
      code: string;
      type: string;
      status: string;
      base: string;
      driverName: string;
      driverPhone: string | null;
      crew: string | null;
      equipment: string | null;
    }>
  ): Promise<AmbulanceRow> {
    // code is unique — wrapped for parity with the repository contract.
    return mapPrismaError(() => db.ambulance.update({ where: { id }, data }) as Promise<AmbulanceRow>);
  }

  async deleteAmbulance(id: string): Promise<void> {
    // Missions reference an ambulance — FK violations map to the shared 409.
    await mapPrismaError(() => db.ambulance.delete({ where: { id } }));
  }
}
