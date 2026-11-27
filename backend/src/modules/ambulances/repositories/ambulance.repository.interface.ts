/**
 * Ambulance repository contract — persistence for the ambulance fleet.
 * The service layer depends on this interface, never on Prisma directly.
 */
export interface AmbulanceRow {
  id: string;
  code: string;
  type: string;
  status: string;
  base: string;
  driverName: string;
  driverPhone: string | null;
  crew: string | null;
  equipment: string | null;
}

export interface AmbulanceListFilter {
  status?: string;
  type?: string;
  /** Free-text needle — legacy matched code OR base OR driverName (contains). */
  q?: string;
}

export interface AmbulanceRepository {
  list(filter: AmbulanceListFilter): Promise<AmbulanceRow[]>;
  findByCode(code: string): Promise<AmbulanceRow | null>;
  findById(id: string): Promise<AmbulanceRow | null>;
  createAmbulance(data: {
    code: string;
    type: string;
    status: string;
    base: string;
    driverName: string;
    driverPhone: string | null;
    crew: string | null;
    equipment: string | null;
  }): Promise<AmbulanceRow>;
  updateAmbulance(
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
  ): Promise<AmbulanceRow>;
  deleteAmbulance(id: string): Promise<void>;
}
