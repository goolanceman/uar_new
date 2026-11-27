/**
 * Appointment repository contract — persistence operations for appointments
 * plus the related-record lookups the workflow rules need (beneficiary by
 * user, professional by user). The service depends on this interface, never
 * on Prisma directly.
 */

/** List scope — filters plus the BENEFICIARY self-scope override. */
export interface AppointmentListScope {
  campId?: string;
  beneficiaryId?: string;
  professionalId?: string;
  type?: string;
  status?: string;
  scheduledAt?: { gte?: Date; lte?: Date };
}

export interface AppointmentListPage {
  items: unknown[];
  total: number;
}

export interface CreateAppointmentData {
  campId: string | null;
  beneficiaryId: string;
  professionalId: string | null;
  type: string;
  scheduledAt: Date;
  notes: string | null;
  status: string;
  createdByName: string;
}

export interface UpdateAppointmentData {
  status?: string;
  noShowReason?: string | null;
  professionalId?: string | null;
  scheduledAt?: Date;
  notes?: string | null;
}

export interface AppointmentRepository {
  findBeneficiaryByUser(userId: string): Promise<{ id: string } | null>;
  findBeneficiaryById(id: string): Promise<{ id: string; name: string } | null>;
  findCampById(id: string): Promise<{ id: string } | null>;
  findProfessionalById(id: string): Promise<{ id: string } | null>;
  findProfessionalByUser(userId: string): Promise<{ id: string } | null>;

  list(scope: AppointmentListScope, skip: number, take: number): Promise<AppointmentListPage>;
  findById(id: string): Promise<{ id: string; status: string; type: string; beneficiaryId: string } | null>;
  findByIdWithDetail(id: string): Promise<unknown | null>;
  create(data: CreateAppointmentData): Promise<unknown>;
  update(id: string, data: UpdateAppointmentData): Promise<{ id: string; status: string; noShowReason: string | null }>;
  delete(id: string): Promise<void>;
}
