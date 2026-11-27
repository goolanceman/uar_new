/**
 * Pad distribution repository contract — persistence for pad drives. The
 * service layer depends on this interface, never on Prisma directly.
 */
export interface PadDistributionRow {
  id: string;
  beneficiaryId: string | null;
  schoolName: string | null;
  area: string;
  girlsCount: number;
  padsDistributed: number;
  awarenessSession: boolean;
  sessionAttendees: number | null;
  volunteerId: string | null;
  volunteerName: string | null;
  distributionDate: Date;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PadDistributionListFilter {
  q?: string;
  session?: boolean;
  from?: Date;
  to?: Date;
  volunteerId?: string;
}

export interface PadDistributionVolunteerRef {
  id: string;
  name: string;
}

export interface PadDistributionAggregate {
  padsDistributed: number | null;
  girlsCount: number | null;
  sessionAttendees: number | null;
}

/** Pre-mutation lookup (PATCH/DELETE ownership gate + delete audit log). */
export interface PadDistributionMutationRef {
  id: string;
  volunteerId: string | null;
  area: string;
  padsDistributed: number;
}

export interface PadDistributionCreateData {
  schoolName: string | null;
  area: string;
  girlsCount: number;
  padsDistributed: number;
  awarenessSession: boolean;
  sessionAttendees: number | null;
  notes: string | null;
  volunteerId: string | null;
  volunteerName: string | null;
  distributionDate: Date;
}

export interface PadDistributionUpdateData {
  schoolName?: string | null;
  area?: string;
  girlsCount?: number;
  padsDistributed?: number;
  awarenessSession?: boolean;
  sessionAttendees?: number | null;
  notes?: string | null;
  volunteerName?: string | null;
  distributionDate?: Date;
  volunteerId?: string | null;
}

export interface PadDistributionRepository {
  /** Paged list, newest distribution first, plus the filtered total. */
  list(filter: PadDistributionListFilter, limit: number, offset: number): Promise<{ rows: PadDistributionRow[]; total: number }>;
  /** Volunteer display names for the rows (no Prisma relation — attached manually). */
  listVolunteerNames(ids: string[]): Promise<PadDistributionVolunteerRef[]>;
  findVolunteerNameById(id: string): Promise<PadDistributionVolunteerRef | null>;
  findVolunteerIdByUserId(userId: string): Promise<{ id: string } | null>;
  findVolunteerIdById(id: string): Promise<{ id: string } | null>;

  create(data: PadDistributionCreateData): Promise<PadDistributionRow>;
  findById(id: string): Promise<PadDistributionRow | null>;
  findForMutation(id: string): Promise<PadDistributionMutationRef | null>;
  update(id: string, data: PadDistributionUpdateData): Promise<PadDistributionRow>;
  remove(id: string): Promise<void>;

  aggregateTotals(filter: PadDistributionListFilter): Promise<PadDistributionAggregate>;
  /** Count of rows in the filter with an awareness session. */
  countAwarenessSessions(filter: PadDistributionListFilter): Promise<number>;
  listDistinctSchools(filter: PadDistributionListFilter): Promise<Array<{ schoolName: string | null }>>;
}
