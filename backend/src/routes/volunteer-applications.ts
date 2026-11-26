/**
 * Volunteer applications routes — /api/volunteer-applications, /api/volunteer-applications/mine, /api/volunteer-applications/:id
 * Converted 1:1 from src/app/api/volunteer-applications/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  ApiError,
  handleError,
  hashPassword,
  json,
  logActivity,
  requireAuth,
  requireRole,
  validateSession,
} from "@/lib/session";
import { loadSettings, emailShell, sendEmail } from "@/lib/notify";
import { nextVolunteerCode } from "@/lib/codes";
import { assertTransition } from "@/lib/workflow";
import { setUserStatus } from "@/lib/user-status";

export const router = Router();

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

// GET /api/volunteer-applications?mine=1 | (ADMIN) ?status&q
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const mine = sp.get("mine") === "1";

    if (mine) {
      const session = await validateSession(req);
      if (!session) throw new ApiError("Please sign in to continue", 401);
      const applications = await db.volunteerApplication.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: "desc" },
      });
      return json(res, applications);
    }

    await requireRole(req, "ADMIN");

    const status = sp.get("status");
    const q = sp.get("q")?.trim();

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { fullName: { contains: q } },
        { email: { contains: q } },
        { city: { contains: q } },
      ];
    }

    const applications = await db.volunteerApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return json(res, applications);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/volunteer-applications — public form (or logged-in user)
// Logged-in callers (web portal AND the mobile app, which now uses this main
// module instead of its compat /volunteer/apply copy) may omit
// fullName/email/phone — the signed-in profile fills the gaps.
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};

    const session = await validateSession(req);
    const sessionUser = session
      ? await db.user.findUnique({ where: { id: session.userId } })
      : null;

    const fullName = String(body?.fullName ?? sessionUser?.name ?? "").trim();
    const email = String(body?.email ?? sessionUser?.email ?? "").trim().toLowerCase();
    const phone = String(body?.phone ?? sessionUser?.phone ?? "").trim();
    const city = String(body?.city ?? "").trim();
    const occupation = body?.occupation ? String(body.occupation).trim() : null;
    const motivation = String(body?.motivation ?? "").trim();

    if (!fullName || !email || !city)
      throw new ApiError("Full name, email and city are required", 400);
    // Anonymous applicants must give a phone; signed-in users may have none on
    // their profile (the mobile form never collects one).
    if (!phone && !sessionUser)
      throw new ApiError("Full name, email, phone and city are required", 400);
    if (motivation.length < 20)
      throw new ApiError("Please tell us a bit more — motivation must be at least 20 characters", 400);

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
    let tempCreds: { email: string; password: string; fullName: string } | undefined;

    if (session) {
      userId = session.userId;
    } else {
      const existing = await db.user.findFirst({
        where: { email: { equals: email } },
      });
      if (existing) {
        // Link account; never downgrade an ADMIN
        await db.user.update({
          where: { id: existing.id },
          data: {
            ...(existing.role !== "ADMIN" ? { role: "VOLUNTEER" } : {}),
            status: "PENDING",
            isActive: false,
          },
        });
        userId = existing.id;
      } else {
        const password = tempPassword();
        const created = await db.user.create({
          data: {
            name: fullName,
            email,
            phone,
            city,
            password: hashPassword(password),
            role: "VOLUNTEER",
            status: "PENDING",
            isActive: false,
          },
        });
        userId = created.id;
        tempCreds = { email, password, fullName };
      }
    }

    const application = await db.volunteerApplication.create({
      data: {
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
      },
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
          console.error("[notify] volunteer application ack failed:", out.message);
      } catch (e) {
        console.error("[notify] volunteer application ack failed", e);
      }
    })();

    return json(res, { application, ...(tempCreds ? { tempCreds } : {}) }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/volunteer-applications/mine — latest application of the signed-in user
router.get("/mine", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const application = await db.volunteerApplication.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
    });
    return json(res, { application: application ?? null });
  } catch (e) {
    return handleError(e, res);
  }
});

const ALLOWED = ["APPROVED", "REJECTED", "PENDING"];
// Review machine: decide from PENDING; a decision can be undone back to
// PENDING, but APPROVED ↔ REJECTED flips must pass through PENDING.
const TRANSITIONS: Record<string, string[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["PENDING"],
  REJECTED: ["PENDING"],
};

// PATCH /api/volunteer-applications/:id — admin reviews an application
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const status = String(body?.status ?? "");
    if (!ALLOWED.includes(status))
      throw new ApiError("Status must be APPROVED, REJECTED or PENDING", 400);

    const application = await db.volunteerApplication.findUnique({ where: { id } });
    if (!application) throw new ApiError("Application not found", 404);

    assertTransition(TRANSITIONS, application.status, status, "volunteer application", 400);

    const data: Record<string, unknown> = { status };
    if (body?.reviewNote !== undefined)
      data.reviewNote = body.reviewNote ? String(body.reviewNote) : null;
    if (body?.adminNotes !== undefined)
      data.adminNotes = body.adminNotes ? String(body.adminNotes) : null;

    if (status === "APPROVED") {
      data.reviewedAt = new Date();
      data.reviewedBy = session.userId;
      if (application.userId) {
        // Account activation goes through the shared User-status owner so the
        // PENDING → ACTIVE transition is validated and audit-logged in one place.
        await setUserStatus(application.userId, "ACTIVE", {
          actorName: session.name,
          actorId: session.userId,
          reason: "volunteer application approved",
          isActive: true,
        });
        await db.user.update({
          where: { id: application.userId },
          data: {
            role: "VOLUNTEER",
            // Mirror the mobile-compat approve: the app routes users by
            // volunteer_status (pending applicants land on the status screen).
            volunteerStatus: "approved",
            volunteerApprovedAt: new Date(),
            volunteerApprovedBy: session.userId,
            volunteerRejectionReason: null,
          },
        });
        const existingVolunteer = await db.volunteer.findUnique({ where: { userId: application.userId } });
        await db.volunteer.upsert({
          where: { userId: application.userId },
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
      data.reviewedAt = new Date();
      if (application.userId) {
        const reason = body?.reason ? String(body.reason) : null;
        await db.user.update({
          where: { id: application.userId },
          data: {
            volunteerStatus: "rejected",
            volunteerRejectionReason: reason ?? (body?.reviewNote ? String(body.reviewNote) : null),
          },
        }).catch(() => undefined); // applicant row may already be gone
      }
    }

    const updated = await db.volunteerApplication.update({
      where: { id },
      data,
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
              console.error("[notify] volunteer approval email failed:", out.message);
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
              console.error("[notify] volunteer decline email failed:", out.message);
          }
        } catch (e) {
          console.error("[notify] volunteer decision email failed", e);
        }
      })();
    }

    return json(res, { application: updated });
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/volunteer-applications/:id — admin removes an application
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;

    const application = await db.volunteerApplication.findUnique({ where: { id } });
    if (!application) throw new ApiError("Application not found", 404);

    await db.volunteerApplication.delete({ where: { id } });

    await logActivity(
      session.name,
      "VOLUNTEER_APPLICATION_DELETE",
      "VOLUNTEER_APPLICATION",
      `${application.fullName} (${application.email})`,
      session.userId
    );

    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
