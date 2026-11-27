/**
 * Volunteer task repository contract — tasks, the volunteer lookups used by
 * the gates/links, and the roster listing. The service layer depends on this
 * interface, never on Prisma directly.
 */
export interface VolunteerTaskRow {
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

export interface VolunteerTaskWithVolunteer extends VolunteerTaskRow {
  volunteer: {
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
    user: { name: string };
  };
}

export interface VolunteerTaskListFilter {
  status?: string;
  type?: string;
  volunteerId?: string;
  refType?: string;
  refId?: string;
  q?: string;
}

export interface CreateVolunteerTaskData {
  volunteerId: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  location: string | null;
  scheduledDate: Date;
  refType: string | null;
  refId: string | null;
  createdFrom: string;
}

export interface UpdateVolunteerTaskData {
  notes?: string | null;
  status?: string;
  completedAt?: Date | null;
}

export interface VolunteerTaskRepository {
  findVolunteerByUserId(userId: string): Promise<{ id: string } | null>;
  findVolunteerByIdWithUser(id: string): Promise<{ id: string; user: { name: string } } | null>;
  listByVolunteer(volunteerId: string): Promise<VolunteerTaskRow[]>;
  list(filter: VolunteerTaskListFilter): Promise<VolunteerTaskWithVolunteer[]>;
  listPaged(
    filter: VolunteerTaskListFilter,
    skip: number,
    take: number
  ): Promise<{ rows: VolunteerTaskWithVolunteer[]; total: number }>;
  findTaskById(id: string): Promise<VolunteerTaskRow | null>;
  create(data: CreateVolunteerTaskData): Promise<VolunteerTaskRow>;
  update(id: string, data: UpdateVolunteerTaskData): Promise<VolunteerTaskRow>;
  delete(id: string): Promise<void>;
}
