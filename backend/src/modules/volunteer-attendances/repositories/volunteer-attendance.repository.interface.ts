/**
 * Volunteer attendance repository contract — the volunteer day register.
 * The service layer depends on this interface, never on Prisma directly.
 */
export interface VolunteerRef {
  id: string;
  status: string;
}

export interface AttendanceRow {
  id: string;
  volunteerId: string;
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  hours: number | null;
  location: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface AttendanceWithVolunteer extends AttendanceRow {
  volunteer: {
    id: string;
    assignedArea: string | null;
    user: { name: string; email: string };
  };
}

export interface AttendanceListFilter {
  volunteerId?: string;
  from?: Date;
  to?: Date;
  limit: number;
}

export interface AttendanceCheckInData {
  checkIn: Date;
  location: string | null;
  notes: string | null;
}

export interface AttendanceUpsertData {
  checkIn: Date | null;
  checkOut: Date | null;
  hours: number | null;
  location: string | null;
  notes: string | null;
}

export interface VolunteerAttendanceRepository {
  findVolunteerByUserId(userId: string): Promise<VolunteerRef | null>;
  findVolunteerById(id: string): Promise<VolunteerRef | null>;
  /** One of the volunteer's own tasks (title + location) by task id. */
  findTaskForVolunteer(
    taskId: string,
    volunteerId: string
  ): Promise<{ title: string; location: string | null } | null>;
  /** Register view — newest days first, volunteer + user names attached. */
  list(filter: AttendanceListFilter): Promise<AttendanceWithVolunteer[]>;
  findAttendanceByVolunteerAndDate(volunteerId: string, date: Date): Promise<AttendanceRow | null>;
  updateAttendance(id: string, data: AttendanceCheckInData): Promise<AttendanceRow>;
  createAttendance(
    data: AttendanceCheckInData & { volunteerId: string; date: Date }
  ): Promise<AttendanceRow>;
  upsertAttendance(volunteerId: string, date: Date, data: AttendanceUpsertData): Promise<AttendanceRow>;
}
