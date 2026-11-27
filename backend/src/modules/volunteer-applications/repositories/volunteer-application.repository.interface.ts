/**
 * Volunteer application repository contract — persistence operations for the
 * application flow (public apply, admin review machine, owner resubmit,
 * deletion) plus the User/Volunteer reads and mirrors the flow writes.
 * The service layer depends on this interface, never on Prisma directly.
 */
import type { User, Volunteer, VolunteerApplication } from "@prisma/client";

/** Full VolunteerApplication row (every legacy handler read whole records). */
export type VolunteerApplicationRow = VolunteerApplication;

/** Signed-in profile fields the apply flow falls back to (body wins). */
export type SessionUserSnapshot = Pick<User, "id" | "name" | "email" | "phone">;

/** Existing-account fields the apply flow reads when linking by email. */
export type ExistingUserSnapshot = Pick<User, "id" | "role">;

/** Link an existing account to a new application (never downgrade an ADMIN). */
export interface UserLinkData {
  role?: string;
  status: string;
  isActive: boolean;
}

/** Auto-created applicant account (POST when no session and no email match). */
export interface ApplicantUserData {
  name: string;
  email: string;
  phone: string;
  city: string;
  password: string;
  role: string;
  status: string;
  isActive: boolean;
}

/** Application create payload (legacy POST data object, in field order). */
export interface VolunteerApplicationCreateData {
  userId: string | null;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  occupation: string | null;
  skills: string | null;
  availability: string | null;
  motivation: string;
  status: string;
  tempCreds?: string;
  customSkills: string | null;
  isFlexible: boolean;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  serviceAreas: string | null;
  willingToTravel: boolean;
  maxTravelDistance: number | null;
  remoteVolunteering: boolean;
  priorExperience: string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
}

/** Application update payload (owner resubmit merge + admin review fields). */
export interface VolunteerApplicationUpdateData {
  status?: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNote?: string | null;
  adminNotes?: string | null;
  fullName?: string;
  email?: string;
  phone?: string;
  city?: string;
  occupation?: string | null;
  motivation?: string;
  skills?: string | null;
  availability?: string | null;
  customSkills?: string | null;
  serviceAreas?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  priorExperience?: string | null;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  willingToTravel?: boolean;
  remoteVolunteering?: boolean;
  isFlexible?: boolean;
  maxTravelDistance?: number | null;
}

/** User mirror writes from the review machine (role flip, badge fields). */
export interface UserMirrorData {
  role?: string;
  status?: string;
  isActive?: boolean;
  volunteerStatus?: string;
  volunteerApprovedAt?: Date;
  volunteerApprovedBy?: string | null;
  volunteerRejectionReason?: string | null;
}

/** Volunteer upsert payloads on approval (legacy create/update branches). */
export interface VolunteerUpsertSpec {
  create: {
    code: string;
    userId: string;
    skills: string | null;
    availability: string | null;
    status: string;
  };
  update: {
    skills: string | undefined;
    availability: string | undefined;
    status: string;
  };
}

export interface VolunteerApplicationRepository {
  /** Own applications, newest first (GET ?mine=1). */
  listByUser(userId: string): Promise<VolunteerApplicationRow[]>;
  /** Admin list with optional exact-status filter and fullName/email/city search. */
  listForAdmin(filter: { status?: string; q?: string }): Promise<VolunteerApplicationRow[]>;

  /** Session-profile lookup on POST (name/email/phone fallbacks). */
  findUserById(id: string): Promise<SessionUserSnapshot | null>;
  /** Existing-account lookup by exact email on anonymous POST. */
  findUserByEmail(email: string): Promise<ExistingUserSnapshot | null>;
  /** Link an existing account (role downgrade guard lives in the service). */
  linkExistingUser(id: string, data: UserLinkData): Promise<User>;
  /** Auto-create the applicant account (unique email — guarded). */
  createApplicantUser(data: ApplicantUserData): Promise<User>;

  findApplicationById(id: string): Promise<VolunteerApplicationRow | null>;
  findLatestByUser(userId: string): Promise<VolunteerApplicationRow | null>;
  createApplication(data: VolunteerApplicationCreateData): Promise<VolunteerApplicationRow>;
  updateApplication(id: string, data: VolunteerApplicationUpdateData): Promise<VolunteerApplicationRow>;
  deleteApplication(id: string): Promise<void>;

  /** Review-machine mirror write (approval path — errors propagate). */
  updateUser(id: string, data: UserMirrorData): Promise<User>;
  /** Applicant-facing mirror write that swallows errors (the applicant row
   *  may already be gone — legacy `.catch(() => undefined)`). */
  updateUserOrIgnore(id: string, data: UserMirrorData): Promise<void>;

  findVolunteerByUserId(userId: string): Promise<Volunteer | null>;
  /** Approval creates the Volunteer roster row (or refreshes it on reapproval). */
  upsertVolunteerForApproval(userId: string, spec: VolunteerUpsertSpec): Promise<Volunteer>;
}
