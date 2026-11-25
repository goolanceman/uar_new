/**
 * Volunteer assignments route — /api/volunteer-assignments
 * Converted 1:1 from src/app/api/volunteer-assignments/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const router = Router();

/**
 * Volunteer assignments — auto-generate VolunteerTasks from another module's
 * record (a distribution drive, a campaign or an awareness event).
 *
 * CONTRACT (consumed by the distributions detail view — do not break):
 *
 * POST /api/volunteer-assignments (ADMIN)
 *   body: {
 *     refType: "DISTRIBUTION" | "CAMPAIGN" | "EVENT",
 *     refId: string,
 *     volunteerIds: string[]   // ≥ 1
 *     title?: string,          // default `${RefType} support`
 *     scheduledDate?: string,  // ISO — default now + 3 days
 *     priority?: "LOW" | "MEDIUM" | "HIGH",
 *     location?: string, notes?: string
 *   }
 *   → 201 { tasks: VolunteerTask[] }   // ONE task per volunteer, createdFrom "AUTO"
 *   Duplicates skipped: volunteer+refType+refId already has a task with
 *   status != CANCELLED. Unknown volunteers → 404. Every task description
 *   mentions the source refId.
 *
 * GET /api/volunteer-assignments?refType=DISTRIBUTION&refId=xxx (ADMIN)
 *   → VolunteerTask[] for that record, newest first, incl. volunteer.user.name
 */

const REF_TYPES = ["DISTRIBUTION", "CAMPAIGN", "EVENT"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// GET /api/volunteer-assignments?refType=&refId= (ADMIN)
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const refType = sp.get("refType")?.trim().toUpperCase() ?? "";
    const refId = sp.get("refId")?.trim() ?? "";
    if (!REF_TYPES.includes(refType as (typeof REF_TYPES)[number]))
      throw new ApiError("refType must be DISTRIBUTION, CAMPAIGN or EVENT", 400);
    if (!refId) throw new ApiError("refId is required", 400);

    const tasks = await db.volunteerTask.findMany({
      where: { refType, refId },
      orderBy: { createdAt: "desc" },
      include: {
        volunteer: {
          select: {
            id: true,
            status: true,
            assignedArea: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });
    return json(res, tasks);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/volunteer-assignments (ADMIN)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const refType = String(body?.refType ?? "").trim().toUpperCase();
    if (!REF_TYPES.includes(refType as (typeof REF_TYPES)[number]))
      throw new ApiError("refType must be DISTRIBUTION, CAMPAIGN or EVENT", 400);
    const refId = String(body?.refId ?? "").trim();
    if (!refId) throw new ApiError("refId is required", 400);

    const volunteerIds = Array.from(
      new Set(
        (Array.isArray(body?.volunteerIds) ? body.volunteerIds : [])
          .map((v) => String(v).trim())
          .filter(Boolean)
      )
    );
    if (volunteerIds.length === 0)
      throw new ApiError("volunteerIds must contain at least one volunteer", 400);

    // Validate the linked record where a model exists (EVENT is free-form today).
    let recordTitle: string | null = null;
    if (refType === "DISTRIBUTION") {
      const record = await db.distribution.findUnique({ where: { id: refId } });
      if (!record) throw new ApiError("Distribution not found", 404);
    } else if (refType === "CAMPAIGN") {
      const record = await db.campaign.findUnique({ where: { id: refId } });
      if (!record) throw new ApiError("Campaign not found", 404);
      recordTitle = record.title;
    }

    // Validate volunteers exist.
    const volunteers = await db.volunteer.findMany({
      where: { id: { in: volunteerIds } },
      include: { user: { select: { name: true } } },
    });
    const foundIds = new Set(volunteers.map((v) => v.id));
    const missing = volunteerIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0)
      throw new ApiError(`Volunteer(s) not found: ${missing.join(", ")}`, 404);

    // Skip duplicates: same volunteer + refType + refId, task not CANCELLED.
    const existing = await db.volunteerTask.findMany({
      where: {
        refType,
        refId,
        volunteerId: { in: volunteerIds },
        status: { not: "CANCELLED" },
      },
      select: { volunteerId: true },
    });
    const alreadyAssigned = new Set(existing.map((e) => e.volunteerId));

    const scheduledDate = body?.scheduledDate
      ? new Date(String(body.scheduledDate))
      : new Date(Date.now() + 3 * 86_400_000);
    if (Number.isNaN(scheduledDate.getTime()))
      throw new ApiError("scheduledDate is not a valid date", 400);

    const priority = String(body?.priority ?? "MEDIUM").trim().toUpperCase();
    if (!PRIORITIES.includes(priority))
      throw new ApiError("priority must be LOW, MEDIUM or HIGH", 400);

    const refLabel = titleCase(refType); // Distribution / Campaign / Event
    const title = String(body?.title ?? "").trim() || `${refLabel} support`;
    const description = `Auto-assigned from ${refLabel} ${refId}${
      recordTitle ? ` — ${recordTitle}` : ""
    }. Generated for United Angel Reach field coordination.`;
    const location = body?.location ? String(body.location).trim() : null;
    const notes = body?.notes ? String(body.notes).trim() : null;
    // DISTRIBUTION refs run distribution drives; campaign/event refs are events.
    const type = refType === "DISTRIBUTION" ? "DISTRIBUTION" : "EVENT";

    const created: Array<{ id: string }> = [];
    for (const volunteer of volunteers) {
      if (alreadyAssigned.has(volunteer.id)) continue;
      created.push(
        await db.volunteerTask.create({
          data: {
            volunteerId: volunteer.id,
            title,
            description,
            type,
            priority,
            location,
            scheduledDate,
            refType,
            refId,
            createdFrom: "AUTO",
            ...(notes ? { notes } : {}),
          },
        })
      );
    }

    await logActivity(
      session.name,
      "VOLUNTEERS_ASSIGNED",
      "VOLUNTEER_TASK",
      `${created.length} task(s) for ${refType} ${refId}${
        created.length < volunteers.length
          ? ` · ${volunteers.length - created.length} duplicate(s) skipped`
          : ""
      }`,
      session.userId
    );

    return json(
      res,
      { tasks: created, skipped: volunteers.length - created.length },
      201
    );
  } catch (e) {
    return handleError(e, res);
  }
});
