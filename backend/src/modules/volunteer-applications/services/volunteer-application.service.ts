/**
 * Volunteer application service — all business rules for the application
 * flow: public apply (with session-profile fallbacks and temp credentials),
 * the admin review machine (status transitions, User.volunteerStatus mirror,
 * Volunteer roster creation on approval), the owner resubmit path and the
 * derived review timeline. Depends on the repository contract, throws
 * application errors, never touches HTTP.
 *
 * Field validation is deliberately NOT in a Zod schema: the legacy handlers
 * validated mid-handler after DB lookups (session profile on POST,
 * 404-before-400 on PATCH) and every 400 message is client-facing contract
 * (web forms + Flutter app inline these exact strings).
 */
import { logger } from "@/infrastructure/logging/logger";
import { hashPassword, logActivity, type Session } from "@/infrastructure/auth/session";
import { loadSettings, emailShell, sendEmail } from "@/infrastructure/notifications/notify";
import { nextVolunteerCode } from "@/domains/codes";
import { assertTransition } from "@/shared/workflow";
import { setUserStatus } from "@/domains/user-status";
import { ApiError } from "@/shared/errors";
import type {
  VolunteerApplicationRepository,
  VolunteerApplicationRow,
  VolunteerApplicationUpdateData,
} from "../repositories/volunteer-application.repository.interface";

const log = logger.child("volunteer-applications");

// ── Statuses & review machine ──────────────────────────────────────────────
// PENDING (submitted) → UNDER_REVIEW → APPROVED | REJECTED | INFO_REQUESTED
// (additional information required); the applicant edits and resubmits an
// INFO_REQUESTED application, which returns it to PENDING. A decision can be
// undone back to PENDING, but APPROVED ↔ REJECTED flips pass through PENDING.
export const VOLUNTEER_APPLICATION_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "INFO_REQUESTED",
] as const;

// Non-decision states: the applicant-facing User.volunteerStatus mirror stays
// (or returns to) "pending" — badges/login routing treat everything else as
// awaiting approval.
const NON_FINAL_REVIEW_STATUSES = ["PENDING", "UNDER_REVIEW", "INFO_REQUESTED"];

const TRANSITIONS: Record<string, string[]> = {
  PENDING: ["UNDER_REVIEW", "INFO_REQUESTED", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["PENDING", "INFO_REQUESTED", "APPROVED", "REJECTED"],
  INFO_REQUESTED: ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"],
  APPROVED: ["PENDING"],
  REJECTED: ["PENDING"],
};

const ALLOWED = VOLUNTEER_APPLICATION_STATUSES;

// ── Field rules — the backend is the authority ────────────────────────────
// The web forms (public + portal) and the Flutter app inline these exact
// strings for live validation; 400 bodies carry them too, so every client
// surfaces identical messages.
const NAME_MIN = 3;
const MOTIVATION_MIN = 20;
const EMAIL_RULE = /^\S+@\S+\.\S+$/;

interface ApplicationInput {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  occupation: string | null;
  motivation: string;
}

export interface TempCredentials {
  email: string;
  password: string;
  fullName: string;
}

export interface TimelineEvent {
  key: string;
  label: string;
  at: string | null;
  note?: string;
}

/** Body value wins over the signed-in profile; both trimmed. */
function applicationInputFrom(
  body: Record<string, unknown>,
  sessionUser: { name?: string | null; email?: string | null; phone?: string | null } | null
): ApplicationInput {
  return {
    fullName: String(body?.fullName ?? sessionUser?.name ?? "").trim(),
    email: String(body?.email ?? sessionUser?.email ?? "").trim().toLowerCase(),
    phone: String(body?.phone ?? sessionUser?.phone ?? "").trim(),
    city: String(body?.city ?? "").trim(),
    occupation: body?.occupation ? String(body.occupation).trim() : null,
    motivation: String(body?.motivation ?? "").trim(),
  };
}

/**
 * Phone rule shared with the web validators' phoneRule: a bare 10-digit
 * number, optionally prefixed with +91 (spaces/dashes tolerated).
 */
function isTenDigitPhone(v: string): boolean {
  const digits = v.replace(/\D/g, "");
  const bare = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return bare.length === 10;
}

function validateApplicationInput(input: ApplicationInput): void {
  if (!input.fullName) throw new ApiError("Full name is required", 400);
  if (input.fullName.length < NAME_MIN)
    throw new ApiError("Full name must be at least 3 characters", 400);
  if (!input.email) throw new ApiError("Email is required", 400);
  if (!EMAIL_RULE.test(input.email))
    throw new ApiError("Enter a valid email address", 400);
  if (!input.phone) throw new ApiError("Phone is required", 400);
  if (!isTenDigitPhone(input.phone))
    throw new ApiError("Phone must be exactly 10 digits", 400);
  if (!input.city) throw new ApiError("City is required", 400);
  if (input.motivation.length < MOTIVATION_MIN)
    throw new ApiError(
      `Please tell us a bit more — motivation must be at least ${MOTIVATION_MIN} characters`,
      400
    );
}

// Normalize skills/availability (string[] or JSON string) → JSON string
function toJsonList(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return JSON.stringify(value.map(String));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(String));
    } catch {
      // plain string → wrap
    }
    return JSON.stringify([value]);
  }
  return null;
}

function tempPassword(): string {
  return `UAR${Math.floor(10000 + Math.random() * 90000)}@`;
}

/**
 * Derive a cheap review timeline from the record's own timestamps — enough
 * for the applicant trackers (web portal + mobile) without a history table.
 */
function buildTimeline(application: {
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewNote: string | null;
}): TimelineEvent[] {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const events: TimelineEvent[] = [
    { key: "SUBMITTED", label: "Application submitted", at: iso(application.createdAt) },
  ];
  if (application.status === "INFO_REQUESTED") {
    events.push({
      key: "INFO_REQUESTED",
      label: "Additional information requested",
      at: iso(application.reviewedAt),
      ...(application.reviewNote ? { note: application.reviewNote } : {}),
    });
  } else if (application.status !== "PENDING") {
    // A decision was (or is being) made after review; the exact hand-over
    // timestamp isn't tracked, so the stage carries no time.
    events.push({ key: "UNDER_REVIEW", label: "Under review", at: null });
  }
  if (application.status === "APPROVED" || application.status === "REJECTED") {
    events.push({
      key: application.status,
      label: application.status === "APPROVED" ? "Application approved" : "Application rejected",
      at: iso(application.reviewedAt),
      ...(application.status === "REJECTED" && application.reviewNote
        ? { note: application.reviewNote }
        : {}),
    });
  }
  return events;
}

export class VolunteerApplicationService {
  constructor(private readonly volunteerApplicationRepository: VolunteerApplicationRepository) {}

  /** GET /api/volunteer-applications?mine=1 — the caller's own applications. */
  async listMine(userId: string): Promise<VolunteerApplicationRow[]> {
    return this.volunteerApplicationRepository.listByUser(userId);
  }

  /** GET /api/volunteer-applications (ADMIN) — ?status&q filters, newest first. */
  async listForAdmin(filter: { status?: string; q?: string }): Promise<VolunteerApplicationRow[]> {
    return this.volunteerApplicationRepository.listForAdmin(filter);
  }

  /** GET /api/volunteer-applications/mine — latest application of the
   *  signed-in user, plus a derived review timeline (submitted/under
   *  review/decision). */
  async getMine(
    userId: string
  ): Promise<{ application: VolunteerApplicationRow | null; timeline?: TimelineEvent[] }> {
    const application = await this.volunteerApplicationRepository.findLatestByUser(userId);
    return {
      application: application ?? null,
      ...(application ? { timeline: buildTimeline(application) } : {}),
    };
  }

  /**
   * POST /api/volunteer-applications — public form (or logged-in user).
   * Logged-in callers (web portal AND the mobile app) may omit
   * fullName/email/phone — the signed-in profile fills the gaps. Anonymous
   * applicants get an account auto-created (or an existing one linked,
   * never downgrading an ADMIN) with temp credentials persisted for the
   * admin reveal at approval time.
   */
  async apply(
    body: Record<string, unknown>,
    session: Session | null
  ): Promise<{ application: VolunteerApplicationRow; tempCreds?: TempCredentials }> {
    const sessionUser = session
      ? await this.volunteerApplicationRepository.findUserById(session.userId)
      : null;

    const input = applicationInputFrom(body, sessionUser);
    validateApplicationInput(input);
    const { fullName, email, phone, city, occupation, motivation } = input;

    const skills = toJsonList(body?.skills);
    const availability = toJsonList(body?.availability);

    // Restored legacy fields (LEGACY_DATABASE_MAPPING.md →
    // volunteer_applications). Everything is optional — the public form only
    // grows, never breaks. Legacy `remote_volunteering` → remoteVolunteering.
    const customSkills = toJsonList(body?.customSkills);
    const serviceAreas = toJsonList(body?.serviceAreas);
    const state = body?.state ? String(body.state).trim() : null;
    const country = body?.country ? String(body.country).trim() : null;
    const postalCode = body?.postalCode ? String(body.postalCode).trim() : null;
    const priorExperience = body?.priorExperience ? String(body.priorExperience).trim() : null;
    const emergencyContact = body?.emergencyContact ? String(body.emergencyContact).trim() : null;
    const emergencyPhone = body?.emergencyPhone ? String(body.emergencyPhone).trim() : null;
    const addressLine1 = body?.addressLine1 ? String(body.addressLine1).trim() : null;
    const addressLine2 = body?.addressLine2 ? String(body.addressLine2).trim() : null;
    let latitude: number | null = null;
    if (body?.latitude !== undefined && body?.latitude !== null && body?.latitude !== "") {
      const v = Number(body.latitude);
      if (!Number.isFinite(v) || v < -90 || v > 90)
        throw new ApiError("latitude must be between -90 and 90", 400);
      latitude = v;
    }
    let longitude: number | null = null;
    if (body?.longitude !== undefined && body?.longitude !== null && body?.longitude !== "") {
      const v = Number(body.longitude);
      if (!Number.isFinite(v) || v < -180 || v > 180)
        throw new ApiError("longitude must be between -180 and 180", 400);
      longitude = v;
    }
    let maxTravelDistance: number | null = null;
    if (body?.maxTravelDistance !== undefined && body?.maxTravelDistance !== null && body?.maxTravelDistance !== "") {
      const v = Number(body.maxTravelDistance);
      if (!Number.isFinite(v) || v < 0 || v > 100000)
        throw new ApiError("maxTravelDistance must be a non-negative number (miles)", 400);
      maxTravelDistance = Math.round(v);
    }
    const isFlexible = Boolean(body?.isFlexible);
    const willingToTravel = Boolean(body?.willingToTravel);
    const remoteVolunteering = Boolean(body?.remoteVolunteering);

    let userId: string | null = null;
    let tempCreds: TempCredentials | undefined;

    if (session) {
      userId = session.userId;
    } else {
      const existing = await this.volunteerApplicationRepository.findUserByEmail(email);
      if (existing) {
        // Link account; never downgrade an ADMIN
        await this.volunteerApplicationRepository.linkExistingUser(existing.id, {
          ...(existing.role !== "ADMIN" ? { role: "VOLUNTEER" } : {}),
          status: "PENDING",
          isActive: false,
        });
        log.debug("volunteer_application_existing_user_linked", {
          userId: existing.id,
        });
        userId = existing.id;
      } else {
        const password = tempPassword();
        const created = await this.volunteerApplicationRepository.createApplicantUser({
          name: fullName,
          email,
          phone,
          city,
          password: hashPassword(password),
          role: "VOLUNTEER",
          status: "PENDING",
          isActive: false,
        });
        userId = created.id;
        log.debug("volunteer_application_account_created", { userId: created.id });
        tempCreds = { email, password, fullName };
      }
    }

    const application = await this.volunteerApplicationRepository.createApplication({
      userId,
      fullName,
      email,
      phone,
      city,
      occupation,
      skills,
      availability,
      motivation,
      status: "PENDING",
      // Persist temp credentials so admins can reveal them at approval time.
      ...(tempCreds ? { tempCreds: JSON.stringify(tempCreds) } : {}),
      // Restored legacy fields
      customSkills,
      isFlexible,
      state,
      country,
      postalCode,
      latitude,
      longitude,
      serviceAreas,
      willingToTravel,
      maxTravelDistance,
      remoteVolunteering,
      priorExperience,
      emergencyContact,
      emergencyPhone,
      addressLine1,
      addressLine2,
    });

    log.info("volunteer_application_submitted", {
      applicationId: application.id,
      userId: userId ?? undefined,
      city,
      status: application.status,
      ...(session ? { actor: session.userId } : {}),
    });

    await logActivity(
      fullName,
      "VOLUNTEER_APPLY",
      "VOLUNTEER_APPLICATION",
      `${email} · ${city}`,
      userId ?? undefined
    );

    // Fire-and-forget acknowledgement to the applicant (senders no-op when disabled)
    void (async () => {
      try {
        const map = await loadSettings();
        const org = {
          name: map["org.name"] || "United Angel Reach",
          footer: map["receipts.footer"] || undefined,
        };
        const credsLine = tempCreds
          ? `<p style="margin:0 0 12px;">Convenience sign-in credentials for your volunteer account will be shared once your application is approved.</p>`
          : "";
        const bodyHtml = `
          <p style="margin:0 0 8px;">Dear ${fullName},</p>
          <p style="margin:0 0 12px;">Thank you for applying to volunteer with ${org.name}. We are glad to have your application and our team reviews every submission with care.</p>
          <p style="margin:0 0 12px;">Your application will be reviewed within <strong>3–5 working days</strong>, and we will write back to you as soon as a decision is made.</p>
          ${credsLine}
          <p style="margin:0;">Warm regards,<br/>The ${org.name} Volunteer Team</p>`;
        const out = await sendEmail(map, {
          to: email,
          subject: `Volunteer application received — ${org.name}`,
          html: emailShell("Volunteer application received", bodyHtml, org),
        });
        if (out && !out.ok && !out.skipped)
          log.error("application_ack_email_failed", { error: out.message, applicationId: application.id, userId: userId ?? undefined });
      } catch (e) {
        log.error("application_ack_email_failed", { error: e, applicationId: application.id, userId: userId ?? undefined });
      }
    })();

    return { application, ...(tempCreds ? { tempCreds } : {}) };
  }

  /**
   * PATCH /api/volunteer-applications/:id
   * - ADMIN: review machine (under review / request info / approve / reject /
   *   undo back to pending). Mirrors User.volunteerStatus for the app badge.
   * - Applicant (owner): may edit and resubmit their OWN application, only
   *   while it is INFO_REQUESTED. Same endpoint and payload shape the web
   *   portal and the mobile app both use.
   */
  async update(
    id: string,
    body: Record<string, unknown>,
    session: Session
  ): Promise<{ application: VolunteerApplicationRow }> {
    const application = await this.volunteerApplicationRepository.findApplicationById(id);
    if (!application) {
      log.warn("volunteer_application_update_not_found", { applicationId: id, actor: session.userId });
      throw new ApiError("Application not found", 404);
    }

    if (session.role !== "ADMIN") {
      if (application.userId !== session.userId) {
        log.warn("volunteer_application_update_forbidden", {
          applicationId: id,
          actor: session.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
      if (application.status !== "INFO_REQUESTED") {
        log.warn("volunteer_application_resubmit_blocked_state", {
          applicationId: id,
          status: application.status,
          actor: session.userId,
        });
        throw new ApiError(
          "Your application can be updated only after additional information is requested",
          403
        );
      }

      // Merge the body over the stored record: fields the client omits (e.g.
      // the web portal form doesn't collect the legacy optionals) keep their
      // current values, then the whole record is re-validated.
      const merged = {
        fullName:
          body?.fullName !== undefined ? String(body.fullName ?? "").trim() : application.fullName,
        email:
          body?.email !== undefined
            ? String(body.email ?? "").trim().toLowerCase()
            : application.email,
        phone: body?.phone !== undefined ? String(body.phone ?? "").trim() : application.phone,
        city: body?.city !== undefined ? String(body.city ?? "").trim() : application.city,
        occupation:
          body?.occupation !== undefined
            ? body.occupation
              ? String(body.occupation).trim()
              : null
            : application.occupation ?? null,
        motivation:
          body?.motivation !== undefined
            ? String(body.motivation ?? "").trim()
            : application.motivation,
      };
      validateApplicationInput(merged);

      const ownerData: VolunteerApplicationUpdateData = { ...merged, status: "PENDING" };
      if (body?.skills !== undefined) ownerData.skills = toJsonList(body.skills);
      if (body?.availability !== undefined) ownerData.availability = toJsonList(body.availability);
      if (body?.customSkills !== undefined) ownerData.customSkills = toJsonList(body.customSkills);
      if (body?.serviceAreas !== undefined) ownerData.serviceAreas = toJsonList(body.serviceAreas);
      if (body?.state !== undefined) ownerData.state = body.state ? String(body.state).trim() : null;
      if (body?.country !== undefined)
        ownerData.country = body.country ? String(body.country).trim() : null;
      if (body?.postalCode !== undefined)
        ownerData.postalCode = body.postalCode ? String(body.postalCode).trim() : null;
      if (body?.priorExperience !== undefined)
        ownerData.priorExperience = body.priorExperience ? String(body.priorExperience).trim() : null;
      if (body?.emergencyContact !== undefined)
        ownerData.emergencyContact = body.emergencyContact ? String(body.emergencyContact).trim() : null;
      if (body?.emergencyPhone !== undefined)
        ownerData.emergencyPhone = body.emergencyPhone ? String(body.emergencyPhone).trim() : null;
      if (body?.addressLine1 !== undefined)
        ownerData.addressLine1 = body.addressLine1 ? String(body.addressLine1).trim() : null;
      if (body?.addressLine2 !== undefined)
        ownerData.addressLine2 = body.addressLine2 ? String(body.addressLine2).trim() : null;
      if (body?.willingToTravel !== undefined) ownerData.willingToTravel = Boolean(body.willingToTravel);
      if (body?.remoteVolunteering !== undefined)
        ownerData.remoteVolunteering = Boolean(body.remoteVolunteering);
      if (body?.isFlexible !== undefined) ownerData.isFlexible = Boolean(body.isFlexible);
      if (body?.maxTravelDistance !== undefined && body?.maxTravelDistance !== null && body?.maxTravelDistance !== "") {
        const v = Number(body.maxTravelDistance);
        if (!Number.isFinite(v) || v < 0 || v > 100000)
          throw new ApiError("maxTravelDistance must be a non-negative number (miles)", 400);
        ownerData.maxTravelDistance = Math.round(v);
      }

      const resubmitted = await this.volunteerApplicationRepository.updateApplication(id, ownerData);

      log.info("volunteer_application_resubmitted", {
        applicationId: id,
        status: resubmitted.status,
        actor: session.userId,
      });

      await logActivity(
        merged.fullName,
        "VOLUNTEER_APPLICATION_RESUBMIT",
        "VOLUNTEER_APPLICATION",
        `${merged.email} · ${merged.city}`,
        session.userId
      );
      return { application: resubmitted };
    }

    const status = String(body?.status ?? "");
    if (!(ALLOWED as readonly string[]).includes(status))
      throw new ApiError(
        `Status must be one of ${ALLOWED.join(", ")}`,
        400
      );

    if (application.status !== status && !TRANSITIONS[application.status]?.includes(status))
      log.warn("volunteer_application_invalid_transition", {
        applicationId: id,
        from: application.status,
        to: status,
        actor: session.userId,
      });
    assertTransition(TRANSITIONS, application.status, status, "volunteer application", 400);

    // Asking for more information without saying what is missing is pointless.
    if (status === "INFO_REQUESTED" && !String(body?.reviewNote ?? "").trim())
      throw new ApiError(
        "A review note is required when requesting additional information",
        400
      );

    const data: VolunteerApplicationUpdateData = { status };
    if (status === "APPROVED" || status === "REJECTED" || status === "INFO_REQUESTED") {
      data.reviewedAt = new Date();
      data.reviewedBy = session.userId;
    }
    if (body?.reviewNote !== undefined)
      data.reviewNote = body.reviewNote ? String(body.reviewNote) : null;
    if (body?.adminNotes !== undefined)
      data.adminNotes = body.adminNotes ? String(body.adminNotes) : null;

    if (NON_FINAL_REVIEW_STATUSES.includes(status)) {
      if (application.userId) {
        // Applicant-facing mirror: every non-decision state reads as
        // "awaiting approval" — including undoing a decision back to PENDING.
        await this.volunteerApplicationRepository.updateUserOrIgnore(application.userId, {
          volunteerStatus: "pending",
        });
      }
    }

    if (status === "APPROVED") {
      if (application.userId) {
        // Account activation goes through the shared User-status owner so the
        // PENDING → ACTIVE transition is validated and audit-logged in one place.
        await setUserStatus(application.userId, "ACTIVE", {
          actorName: session.name,
          actorId: session.userId,
          reason: "volunteer application approved",
          isActive: true,
        });
        await this.volunteerApplicationRepository.updateUser(application.userId, {
          role: "VOLUNTEER",
          // Mirror the mobile-compat approve: the app routes users by
          // volunteer_status (pending applicants land on the status screen).
          volunteerStatus: "approved",
          volunteerApprovedAt: new Date(),
          volunteerApprovedBy: session.userId,
          volunteerRejectionReason: null,
        });
        const existingVolunteer = await this.volunteerApplicationRepository.findVolunteerByUserId(application.userId);
        if (existingVolunteer)
          log.debug("volunteer_application_reapproval_existing_volunteer", {
            applicationId: id,
            volunteerId: existingVolunteer.id,
            actor: session.userId,
          });
        await this.volunteerApplicationRepository.upsertVolunteerForApproval(application.userId, {
          create: {
            code: existingVolunteer ? existingVolunteer.code : await nextVolunteerCode(),
            userId: application.userId,
            skills: application.skills,
            availability: application.availability,
            status: "ACTIVE",
          },
          update: {
            skills: application.skills ?? undefined,
            availability: application.availability ?? undefined,
            status: "ACTIVE",
          },
        });
      }
    } else if (status === "REJECTED") {
      if (application.userId) {
        const reason = body?.reason ? String(body.reason) : null;
        await this.volunteerApplicationRepository.updateUserOrIgnore(application.userId, {
          volunteerStatus: "rejected",
          volunteerRejectionReason: reason ?? (body?.reviewNote ? String(body.reviewNote) : null),
        });
      }
    }

    const updated = await this.volunteerApplicationRepository.updateApplication(id, data);

    log.info("volunteer_application_reviewed", {
      applicationId: id,
      from: application.status,
      to: status,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      `VOLUNTEER_APPLICATION_${status}`,
      "VOLUNTEER_APPLICATION",
      `${application.fullName} (${application.email})`,
      session.userId
    );

    // Fire-and-forget decision email — only when the status actually changed
    if (status !== application.status && (status === "APPROVED" || status === "REJECTED")) {
      void (async () => {
        try {
          const map = await loadSettings();
          const org = {
            name: map["org.name"] || "United Angel Reach",
            footer: map["receipts.footer"] || undefined,
          };

          if (status === "APPROVED") {
            // Mirror the PATCH response: temp credentials are revealed to the
            // reviewer, so include them here only when they exist on the record.
            let credsBlock = "";
            if (application.tempCreds) {
              try {
                const creds = JSON.parse(application.tempCreds) as {
                  email?: string;
                  password?: string;
                };
                if (creds?.email && creds?.password) {
                  credsBlock = `
                    <p style="margin:0 0 12px;">Your volunteer portal sign-in:<br/>
                    Email: <strong>${creds.email}</strong><br/>
                    Temporary password: <strong>${creds.password}</strong><br/>
                    <em>Please change your password after your first sign-in.</em></p>`;
                }
              } catch {
                // malformed tempCreds — skip the credentials block
              }
            }
            const bodyHtml = `
              <p style="margin:0 0 8px;">Dear ${application.fullName},</p>
              <p style="margin:0 0 12px;">Congratulations! Your volunteer application with ${org.name} has been <strong>approved</strong>. Welcome aboard — we are thrilled to have you on the team.</p>
              <p style="margin:0 0 12px;"><strong>Next steps:</strong> sign in to your volunteer portal to view your profile, browse upcoming tasks and sign up for distributions near you. A coordinator will reach out shortly to help you get started.</p>
              ${credsBlock}
              <p style="margin:0;">Warm regards,<br/>The ${org.name} Volunteer Team</p>`;
            const out = await sendEmail(map, {
              to: application.email,
              subject: `Your volunteer application is approved — ${org.name}`,
              html: emailShell("Volunteer application approved", bodyHtml, org),
            });
            if (out && !out.ok && !out.skipped)
              log.error("approval_email_failed", { error: out.message, applicationId: application.id, userId: application.userId });
          } else {
            const bodyHtml = `
              <p style="margin:0 0 8px;">Dear ${application.fullName},</p>
              <p style="margin:0 0 12px;">Thank you for taking the time to apply to volunteer with ${org.name}. After careful review, we are unable to move forward with your application at this time.</p>
              <p style="margin:0 0 12px;">This is in no way a judgement of your willingness to serve — capacity and role fit change often, and we would be glad to see you apply again in the future.</p>
              <p style="margin:0;">With sincere thanks,<br/>The ${org.name} Volunteer Team</p>`;
            const out = await sendEmail(map, {
              to: application.email,
              subject: `Update on your volunteer application — ${org.name}`,
              html: emailShell("Volunteer application update", bodyHtml, org),
            });
            if (out && !out.ok && !out.skipped)
              log.error("decline_email_failed", { error: out.message, applicationId: application.id, userId: application.userId });
          }
        } catch (e) {
          log.error("decision_email_failed", { error: e, applicationId: application.id, userId: application.userId });
        }
      })();
    }

    return { application: updated };
  }

  /** DELETE /api/volunteer-applications/:id — admin removes an application. */
  async remove(id: string, session: Session): Promise<{ ok: true }> {
    const application = await this.volunteerApplicationRepository.findApplicationById(id);
    if (!application) {
      log.warn("volunteer_application_delete_not_found", { applicationId: id, actor: session.userId });
      throw new ApiError("Application not found", 404);
    }

    await this.volunteerApplicationRepository.deleteApplication(id);

    log.info("volunteer_application_deleted", {
      applicationId: id,
      status: application.status,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "VOLUNTEER_APPLICATION_DELETE",
      "VOLUNTEER_APPLICATION",
      `${application.fullName} (${application.email})`,
      session.userId
    );

    return { ok: true };
  }
}
