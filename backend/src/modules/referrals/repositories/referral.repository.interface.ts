/**
 * Referral repository contract — persistence operations for medical
 * referrals plus the related-record lookups the workflow rules need
 * (organisation by owner, beneficiary by user). The service depends on this
 * interface, never on Prisma directly.
 */
export interface ReferralOrgRef {
  id: string;
  name?: string;
}

export interface ReferralIncludeFull {
  beneficiary: { select: { id: true; code: true; name: true; age: true; gender: true } };
  camp: { select: { id: true; code: true; title: true } };
  encounter: { select: { id: true; status: true; diagnosis: true } };
  receivingOrg: { select: { id: true; name: true; type: true; city: true } };
}

/** List scope — role-derived constraints plus the admin/doctor/nurse filters. */
export interface ReferralListScope {
  receivingOrgId?: string;
  beneficiaryId?: string;
  status?: string;
  priority?: string;
}

export interface ReferralListPage {
  items: unknown[];
  total: number;
}

export interface CreateReferralData {
  code: string;
  beneficiaryId: string;
  campId: string | null;
  encounterId: string | null;
  reason: string;
  priority: string;
  receivingOrgId: string | null;
  speciality: string | null;
  referralDoctorName: string;
  status: string;
}

export interface UpdateReferralData {
  status?: string;
  notes?: string | null;
}

export interface ReferralRepository {
  findOrgByOwner(ownerUserId: string): Promise<ReferralOrgRef | null>;
  findOrgById(id: string): Promise<{ id: string } | null>;
  findBeneficiaryByUser(userId: string): Promise<{ id: string } | null>;
  findBeneficiaryById(id: string): Promise<{ id: string; code: string } | null>;
  findCampById(id: string): Promise<{ id: string } | null>;
  findEncounterById(id: string): Promise<{ id: string } | null>;

  list(scope: ReferralListScope, skip: number, limit: number): Promise<ReferralListPage>;
  findByIdWithFollowUps(id: string): Promise<unknown | null>;
  findById(id: string): Promise<{ id: string; code: string; status: string; receivingOrgId: string | null } | null>;
  create(data: CreateReferralData): Promise<unknown>;
  update(id: string, data: UpdateReferralData): Promise<unknown>;
}
