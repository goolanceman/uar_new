/**
 * Volunteer assignment repository contract — persistence for auto-generated
 * VolunteerTasks. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface VolunteerRefRow {
  id: string;
  user: { name: string | null };
}

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

/** GET list row — volunteer summary attached (legacy include select). */
export interface VolunteerTaskWithVolunteer extends VolunteerTaskRow {
  volunteer: {
    id: string;
    status: string;
    assignedArea: string | null;
    user: { name: string | null; email: string | null };
  };
}

export interface CreateVolunteerTaskData {
  volunteerId: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  location: string | null;
  scheduledDate: Date;
  refType: string;
  refId: string;
  createdFrom: string;
  notes?: string | null;
}

export interface VolunteerAssignmentRepository {
  /** Tasks for one source record, newest first, volunteer summary attached. */
  listTasksByRef(refType: string, refId: string): Promise<VolunteerTaskWithVolunteer[]>;
  findDistributionById(id: string): Promise<{ id: string } | null>;
  findCampaignById(id: string): Promise<{ id: string; title: string } | null>;
  findVolunteersByIds(ids: string[]): Promise<VolunteerRefRow[]>;
  /** Volunteer ids that already have a non-CANCELLED task for the record. */
  findExistingTaskVolunteerIds(refType: string, refId: string, volunteerIds: string[]): Promise<string[]>;
  createTask(data: CreateVolunteerTaskData): Promise<VolunteerTaskRow>;
}
