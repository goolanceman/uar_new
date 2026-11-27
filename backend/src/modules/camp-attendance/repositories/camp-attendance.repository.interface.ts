/**
 * Camp attendance repository contract — the camp queue (registrations,
 * attendance rows, queue tokens, doctor lookups). The service layer depends
 * on this interface, never on Prisma directly.
 */
export interface CampAttendanceRow {
  id: string;
  registrationId: string;
  campId: string;
  beneficiaryId: string;
  status: string;
  queueToken: number | null;
  checkInAt: Date | null;
  checkInMethod: string | null;
  operatorName: string | null;
  doctorId: string | null;
  checkOutAt: Date | null;
  cancelReason: string | null;
}

/** HOSPITAL callers only see camps their org partners. */
export interface CampScope {
  campPartners: { some: { orgId: string } };
}

export interface RegistrationWithCamp {
  id: string;
  campId: string;
  beneficiaryId: string;
  code: string;
  status: string;
  camp: { status: string; title: string };
  attendance: CampAttendanceRow | null;
}

export interface AttendanceListFilter {
  campId?: string;
  status?: string;
}

export interface AttendanceListRow extends CampAttendanceRow {
  beneficiary: {
    id: string;
    code: string;
    name: string;
    phone: string | null;
    age: number | null;
    gender: string | null;
  };
  registration: { id: string; code: string; status: string };
}

export interface AttendanceCheckInData {
  status: string;
  checkInAt: Date;
  checkInMethod: string;
  operatorName: string;
  queueToken: number | null;
  cancelReason: null;
}

export interface AttendanceCreateData extends AttendanceCheckInData {
  registrationId: string;
  campId: string;
  beneficiaryId: string;
}

export interface AttendanceUpdateData {
  status: string;
  checkOutAt?: Date;
  cancelReason?: string | null;
  doctorId?: string | null;
}

export interface CampAttendanceRepository {
  findOrgIdByOwner(userId: string): Promise<string | null>;
  campInScope(campId: string, scope?: CampScope): Promise<{ id: string } | null>;
  countActiveRegistrations(campId: string): Promise<number>;
  attendanceStatusCounts(campId: string): Promise<Array<{ status: string; count: number }>>;
  list(
    filter: AttendanceListFilter,
    orgScope: CampScope | undefined,
    skip: number,
    take: number
  ): Promise<AttendanceListRow[]>;
  count(filter: AttendanceListFilter, orgScope: CampScope | undefined): Promise<number>;
  findRegistrationFull(registrationId: string): Promise<RegistrationWithCamp | null>;
  aggregateMaxQueueToken(campId: string): Promise<number | null>;
  create(data: AttendanceCreateData): Promise<CampAttendanceRow>;
  findAttendanceWithRegistrationCode(id: string): Promise<
    (CampAttendanceRow & { registration: { code: string } }) | null
  >;
  findDoctorById(id: string): Promise<{ id: string } | null>;
  update(id: string, data: AttendanceUpdateData): Promise<CampAttendanceRow>;
}
