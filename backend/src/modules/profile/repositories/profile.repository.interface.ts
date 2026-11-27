/**
 * Profile repository contract — persistence operations for /api/profile*,
 * spanning the user record, the KYC verifications and the role-aware CRM
 * aggregates (donor / volunteer / beneficiary / activity trail). The service
 * depends on this interface, never on Prisma directly.
 */

/**
 * Full user row as the profile flows read it: the safeUser whitelist fields,
 * the community (mobile) fields consumed by communityUser(), plus the
 * credential / verification-state columns the flows inspect. Responses are
 * built through whitelists (safeUser / fullSelfUser), so the password never
 * reaches a response body.
 */
export interface ProfileUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  isActive: boolean;
  phone: string | null;
  city: string | null;
  pan: string | null;
  about: string | null;
  avatar: string | null;
  password: string;
  username: string | null;
  emailVerifiedAt: Date | null;
  backgroundImage: string | null;
  interestIds: string | null;
  isPushNotifications: number;
  isInvitedToRoom: number;
  isVerified: number;
  isBlock: number;
  blockUserIds: string | null;
  savedMusicIds: string | null;
  savedReelIds: string | null;
  savedPostIds: string | null;
  isModerator: number;
  loginType: number;
  deviceType: number;
  deviceToken: string | null;
  fcmToken: string | null;
  apnsToken: string | null;
  userType: string | null;
  volunteerStatus: string | null;
  volunteerRequestedAt: Date | null;
  totalPoints: number;
  currentTier: string;
  followingCount: number;
  followersCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** PATCH /api/profile column values (only assigned keys are present). */
export interface ProfileUpdateData {
  name?: string;
  phone?: string | null;
  city?: string | null;
  about?: string | null;
  username?: string;
  interestIds?: string | null;
  blockUserIds?: string | null;
  savedMusicIds?: string | null;
  savedReelIds?: string | null;
  savedPostIds?: string | null;
  isPushNotifications?: number;
  isInvitedToRoom?: number;
  avatar?: string | null;
  backgroundImage?: string | null;
}

/** POST /api/profile/user-type — one-time choice; volunteers enter the
 *  pending approval pipeline (status + request timestamp). */
export interface UserTypeData {
  userType: string;
  volunteerStatus?: string;
  volunteerRequestedAt?: Date;
}

/** POST /api/profile/device-token — platform 'ios' stores the token in
 *  apnsToken, anything else in fcmToken; deviceToken/deviceType stay in sync. */
export interface DeviceTokenData {
  apnsToken?: string;
  fcmToken?: string;
  deviceType: number;
  deviceToken: string;
}

/** POST /api/profile/verification — KYC submission row. */
export interface VerificationCreateData {
  userId: string;
  selfie: string;
  document: string;
  documentType: string;
  fullName: string;
}

export interface VerificationRow {
  id: string;
  userId: string;
  selfie: string;
  document: string;
  documentType: string;
  fullName: string;
  createdAt: Date;
  updatedAt: Date;
}

/** donation.aggregate projection (amount sum + row count + first/last gift). */
export interface DonationAggregate {
  sumAmount: number | null;
  count: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

export interface CategorySlice {
  category: string;
  amount: number | null;
  count: number;
}

export interface TypeSlice {
  type: string;
  count: number;
}

export interface StatusSlice {
  status: string;
  count: number;
}

export interface EntitySlice {
  entityType: string;
  count: number;
}

/** Full donor CRM row (serialized wholesale as extras.donor). */
export interface DonorProfileRow {
  id: string;
  code: string;
  type: string;
  organizationName: string | null;
  name: string;
  email: string;
  phone: string | null;
  altPhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  pan: string | null;
  language: string | null;
  source: string | null;
  category: string | null;
  wants80g: boolean;
  anonymousByDefault: boolean;
  emailOptIn: boolean;
  smsOptIn: boolean;
  whatsappOptIn: boolean;
  tags: string | null;
  notes: string | null;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Recent-donations select of the donor analytics (campaign title included). */
export interface RecentDonationRow {
  id: string;
  receiptNumber: string;
  amount: number;
  category: string;
  type: string;
  paymentStatus: string;
  createdAt: Date;
  campaign: { title: string } | null;
}

/** Full volunteer CRM row (serialized wholesale as extras.volunteer). */
export interface VolunteerProfileRow {
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

/** Full volunteer task row (analytics projects fields per list). */
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

/** Full beneficiary CRM row (serialized wholesale as extras.beneficiary). */
export interface BeneficiaryProfileRow {
  id: string;
  code: string;
  userId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  category: string;
  urgencyLevel: string;
  familyMembers: number;
  monthlyIncome: number | null;
  monthlyNeed: number | null;
  needs: string | null;
  documents: string | null;
  notes: string | null;
  isActive: boolean;
  onboardedByName: string | null;
  caseStatus: string;
  caseWorker: string | null;
  verificationStatus: string;
  guardian: string | null;
  age: number | null;
  gender: string | null;
  photoConsent: boolean;
  intakeDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  bloodGroup: string | null;
  allergies: string | null;
  currentMedications: string | null;
  medicalConditions: string | null;
  medicalHistory: string | null;
  preferredLanguage: string | null;
  emergencyContact: string | null;
  kycStatus: string;
  kycDocuments: string | null;
  kycNotes: string | null;
  kycReviewedAt: Date | null;
  kycReviewedBy: string | null;
}

/** Full help-request row (GET / and analytics project fields per list). */
export interface BeneficiaryRequestRow {
  id: string;
  beneficiaryId: string | null;
  userId: string | null;
  name: string;
  phone: string | null;
  category: string;
  urgency: string;
  details: string;
  status: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  refCode: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  familyMembers: number | null;
  childrenCount: number | null;
  seniorCount: number | null;
  dietary: string | null;
  preferredContact: string | null;
  consent: boolean;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Full audit-trail row (ADMIN analytics + stats). */
export interface ActivityRow {
  id: string;
  userId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface ProfileRepository {
  // ── User record + profile edits ──
  findUserById(id: string): Promise<ProfileUserRow | null>;
  findUsernameOwner(username: string, excludingUserId: string): Promise<{ id: string } | null>;
  updateProfile(id: string, data: ProfileUpdateData): Promise<ProfileUserRow>;
  setUserType(id: string, data: UserTypeData): Promise<ProfileUserRow>;
  setUserPassword(id: string, passwordHash: string): Promise<void>;
  setDeviceToken(id: string, data: DeviceTokenData): Promise<void>;
  clearDeviceTokens(id: string): Promise<void>;

  // ── KYC verification ──
  createVerification(data: VerificationCreateData): Promise<VerificationRow>;
  markVerificationPending(id: string): Promise<void>;

  // ── Donor CRM (GET / + analytics) ──
  findDonorProfile(userId: string, email: string): Promise<DonorProfileRow | null>;
  aggregateDonations(userId: string, email: string): Promise<DonationAggregate>;
  aggregateCompletedDonations(userId: string, email: string): Promise<DonationAggregate>;
  listSupportedCampaignIds(userId: string, email: string): Promise<Array<{ campaignId: string | null }>>;
  listCompletedDonationsSince(
    userId: string,
    email: string,
    since: Date
  ): Promise<Array<{ createdAt: Date; amount: number }>>;
  listRecentDonations(userId: string, email: string, take: number): Promise<RecentDonationRow[]>;
  groupCompletedDonationsByCategory(userId: string, email: string): Promise<CategorySlice[]>;

  // ── Volunteer CRM (GET / + analytics) ──
  findVolunteerProfile(userId: string): Promise<VolunteerProfileRow | null>;
  countVolunteerTasksNotCancelled(volunteerId: string): Promise<number>;
  countVolunteerTasksCompleted(volunteerId: string): Promise<number>;
  countVolunteerAttendance(volunteerId: string): Promise<number>;
  sumVolunteerAttendanceHours(volunteerId: string): Promise<number | null>;
  groupVolunteerTasksByType(volunteerId: string): Promise<TypeSlice[]>;
  listUpcomingVolunteerTasks(volunteerId: string, now: Date, take: number): Promise<VolunteerTaskRow[]>;
  listRecentVolunteerTasks(volunteerId: string, take: number): Promise<VolunteerTaskRow[]>;

  // ── Beneficiary CRM (GET / + analytics) ──
  findBeneficiaryProfile(userId: string): Promise<BeneficiaryProfileRow | null>;
  countBeneficiaryRequests(userId: string, beneficiaryId: string | null): Promise<number>;
  groupBeneficiaryRequestsByStatus(userId: string, beneficiaryId: string | null): Promise<StatusSlice[]>;
  listRecentBeneficiaryRequests(
    userId: string,
    beneficiaryId: string | null,
    take: number
  ): Promise<BeneficiaryRequestRow[]>;

  // ── Audit trail (ADMIN) ──
  countActivityByUser(userId: string): Promise<number>;
  groupActivityByEntity(userId: string): Promise<EntitySlice[]>;
  listRecentActivity(userId: string, take: number): Promise<ActivityRow[]>;
}
