/**
 * Volunteer repository contract — roster listings, profiles and the
 * analytics roll-up reads. The service layer depends on this interface,
 * never on Prisma directly.
 */
export interface VolunteerRow {
  id: string;
  code: string;
  userId: string;
  skills: string | null;
  availability: string | null;
  assignedArea: string | null;
  emergencyContact: string | null;
  idProof: string | null;
  status: string;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface VolunteerWithUser extends VolunteerRow {
  user: { name: string; email: string; phone: string | null; city: string | null };
}

export interface VolunteerTaskSummaryRow {
  id: string;
  volunteerId: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  location: string | null;
  scheduledDate: Date;
  status: string;
  completedAt: Date | null;
  notes: string | null;
  refType: string | null;
  refId: string | null;
  createdFrom: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VolunteerAttendanceSummaryRow {
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

export interface VolunteerDetail extends VolunteerRow {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    city: string | null;
    status: string;
  };
  tasks: VolunteerTaskSummaryRow[];
  attendances: VolunteerAttendanceSummaryRow[];
}

export interface VolunteerWithTasks extends VolunteerRow {
  tasks: VolunteerTaskSummaryRow[];
}

export interface VolunteerListFilter {
  status?: string;
}

export interface VolunteerApplicationRow {
  id: string;
  userId: string | null;
  status: string;
  createdAt: Date;
}

export interface VolunteerUpdateData {
  skills?: string | null;
  availability?: string | null;
  assignedArea?: string | null;
  emergencyContact?: string | null;
  idProof?: string | null;
  status?: string;
}

export interface VolunteerRepository {
  list(filter: VolunteerListFilter): Promise<VolunteerWithUser[]>;
  listPaged(
    filter: VolunteerListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: VolunteerWithUser[]; total: number }>;
  countPendingApplications(): Promise<number>;
  listRosterSummaries(): Promise<Array<{ id: string; status: string; user: { name: string } }>>;
  listTaskSummaries(): Promise<Array<{ type: string; status: string; volunteerId: string }>>;
  listAttendanceSince(date: Date): Promise<Array<{ date: Date; hours: number | null }>>;
  findByUserIdWithTasks(userId: string): Promise<VolunteerWithTasks | null>;
  findLatestApplication(userId: string): Promise<VolunteerApplicationRow | null>;
  findById(id: string): Promise<VolunteerRow | null>;
  findDetailById(id: string): Promise<VolunteerDetail | null>;
  update(id: string, data: VolunteerUpdateData): Promise<VolunteerRow>;
}
