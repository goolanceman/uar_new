/**
 * Medical camp routes — /api/medical-camps, /api/medical-camps/:id
 * Converted 1:1 from src/app/api/medical-camps/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ApiError,
  handleError,
  json,
  logActivity,
  requireAuth,
  requireRole,
  validateSession,
} from "@/lib/session";
import { nextCampCode } from "@/lib/health-codes";

export const router = Router();

const log = logger.child("medical-camps");

const CAMP_STATUSES = ["DRAFT", "SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"];

/** Allowed forward transitions — COMPLETED and CANCELLED are terminal. */
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["LIVE", "CANCELLED"],
  LIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Normalise an array | comma string | JSON array string into a JSON array string. */
function stringList(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  let raw: unknown = v;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      raw = s.split(",");
    }
  }
  if (!Array.isArray(raw)) return null;
  const arr = raw.map((x) => String(x).trim()).filter(Boolean);
  return arr.length ? JSON.stringify(arr) : null;
}

function pageParams(sp: URLSearchParams) {
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const take = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "24", 10) || 24));
  return { page, take, skip: (page - 1) * take };
}

function envelope<T>(items: T[], total: number, page: number, take: number) {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

// GET /api/medical-camps?q&status&city&campaignId&upcoming=1&withCounts=1&page&limit
// PUBLIC for anonymous visitors: only SCHEDULED/LIVE/COMPLETED camps, with
// internal fields (notes, budget, createdByName) stripped. Authenticated
// users (staff/roles) get the full record set.
router.get("/", async (req, res) => {
  try {
    const session = await validateSession(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
    const q = sp.get("q")?.trim() || undefined;
    const status = sp.get("status") || undefined;
    const city = sp.get("city") || undefined;
    const campaignId = sp.get("campaignId") || undefined;
    const upcoming = sp.get("upcoming") === "1";
    const withCounts = sp.get("withCounts") === "1";
    const { page, take, skip } = pageParams(sp);

    const where: Prisma.MedicalCampWhereInput = {};
    const requestedStatus = status ? (CAMP_STATUSES.includes(status) ? status : status.toUpperCase()) : undefined;
    if (requestedStatus) where.status = requestedStatus;
    if (!session) {
      // Anonymous: clamp to publicly visible statuses.
      const PUBLIC_STATUSES = ["SCHEDULED", "LIVE", "COMPLETED"];
      if (!requestedStatus || !PUBLIC_STATUSES.includes(requestedStatus))
        where.status = { in: PUBLIC_STATUSES };
    }
    if (city) where.city = city;
    if (campaignId) where.campaignId = campaignId;
    if (upcoming) {
      where.campDate = { gte: new Date() };
      where.status = { in: ["SCHEDULED", "LIVE"] };
    }
    if (q)
      where.OR = [
        { title: { contains: q } },
        { code: { contains: q } },
        { venue: { contains: q } },
        { city: { contains: q } },
      ];

    const [camps, total] = await Promise.all([
      db.medicalCamp.findMany({
        where,
        orderBy: upcoming ? { campDate: "asc" } : { campDate: "desc" },
        skip,
        take,
        include: {
          campaign: { select: { id: true, title: true, slug: true, accent: true, icon: true } },
          _count: { select: { registrations: true } },
        },
      }),
      db.medicalCamp.count({ where }),
    ]);

    let items = camps as typeof camps;
    if (withCounts && camps.length) {
      const ids = camps.map((c) => c.id);
      const [checkedInAgg, completedAgg] = await Promise.all([
        db.campAttendance.groupBy({
          by: ["campId"],
          where: { campId: { in: ids }, checkInAt: { not: null } },
          _count: { _all: true },
        }),
        db.campAttendance.groupBy({
          by: ["campId"],
          where: { campId: { in: ids }, status: "COMPLETED" },
          _count: { _all: true },
        }),
      ]);
      const checkedInMap = new Map(checkedInAgg.map((r) => [r.campId, r._count._all]));
      const completedMap = new Map(completedAgg.map((r) => [r.campId, r._count._all]));
      items = camps.map((c) => ({
        ...c,
        counts: {
          registrations: c._count.registrations,
          checkedIn: checkedInMap.get(c.id) ?? 0,
          completed: completedMap.get(c.id) ?? 0,
        },
      }));
    }

    // Strip internal fields from public (anonymous) responses.
    if (!session) {
      items = items.map((c) => {
        const { notes: _notes, budget: _budget, createdByName: _createdBy, ...pub } = c as typeof c & {
          notes?: unknown;
          budget?: unknown;
          createdByName?: unknown;
        };
        void _notes;
        void _budget;
        void _createdBy;
        return pub as (typeof items)[number];
      });
    }

    return json(res, envelope(items, total, page, take));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/medical-camps (ADMIN) — auto code, createdByName from session
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const title = String(body.title ?? "").trim();
    if (!title) throw new ApiError("title is required", 400);
    const venue = String(body.venue ?? "").trim();
    if (!venue) throw new ApiError("venue is required", 400);

    const campDate = body.campDate ? new Date(String(body.campDate)) : null;
    if (!campDate || Number.isNaN(campDate.getTime()))
      throw new ApiError("campDate is required and must be a valid date", 400);

    let capacity = 200;
    if (body.capacity !== undefined && String(body.capacity).trim() !== "") {
      capacity = Math.trunc(Number(body.capacity));
      if (!Number.isFinite(capacity) || capacity < 1)
        throw new ApiError("capacity must be a positive number", 400);
    }

    if (body.campaignId) {
      const campaign = await db.campaign.findUnique({ where: { id: String(body.campaignId) } });
      if (!campaign) {
        log.warn("medical_camp_campaign_not_found", {
          campaignId: String(body.campaignId),
          actor: session.userId,
        });
        throw new ApiError("Campaign not found", 404);
      }
    }

    const code = await nextCampCode();
    const camp = await db.medicalCamp.create({
      data: {
        code,
        title,
        description: body.description ? String(body.description).trim() : null,
        campaignId: body.campaignId ? String(body.campaignId) : null,
        campDate,
        startTime: body.startTime ? String(body.startTime).trim() : null,
        endTime: body.endTime ? String(body.endTime).trim() : null,
        venue,
        city: body.city ? String(body.city).trim() : null,
        capacity,
        expectedCount: body.expectedCount ? Math.trunc(Number(body.expectedCount)) : null,
        services: stringList(body.services),
        status: "DRAFT",
        coordinatorName: body.coordinatorName ? String(body.coordinatorName).trim() : null,
        budget: body.budget !== undefined && body.budget !== null && String(body.budget).trim() !== ""
          ? Number(body.budget)
          : null,
        notes: body.notes ? String(body.notes).trim() : null,
        createdByName: session.name,
      },
    });

    log.info("medical_camp_created", {
      campId: camp.id,
      code: camp.code,
      city: camp.city,
      status: camp.status,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_CREATE",
      "MedicalCamp",
      `${camp.code} — ${camp.title}`,
      session.userId
    );
    return json(res, camp, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/medical-camps/:id — any authenticated user; partners, staff and counts
router.get("/:id", async (req, res) => {
  try {
    await requireAuth(req);
    const { id } = req.params;
    const camp = await db.medicalCamp.findUnique({
      where: { id },
      include: {
        campaign: { select: { id: true, title: true, slug: true, accent: true, icon: true } },
        campPartners: {
          include: { org: { select: { id: true, name: true, type: true, city: true, status: true } } },
        },
        campStaff: {
          include: {
            professional: { select: { id: true, name: true, kind: true, speciality: true } },
          },
        },
      },
    });
    if (!camp) throw new ApiError("Camp not found", 404);

    const [registrations, checkedIn, completed] = await Promise.all([
      db.campRegistration.count({ where: { campId: id } }),
      db.campAttendance.count({ where: { campId: id, checkInAt: { not: null } } }),
      db.campAttendance.count({ where: { campId: id, status: "COMPLETED" } }),
    ]);

    return json(res, {
      ...camp,
      counts: { registrations, checkedIn, completed },
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/medical-camps/:id (ADMIN) — field edits + validated lifecycle
// DRAFT→SCHEDULED→LIVE→COMPLETED / CANCELLED (terminal states cannot reopen).
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.medicalCamp.findUnique({ where: { id } });
    if (!existing) {
      log.warn("medical_camp_update_not_found", { campId: id, actor: session.userId });
      throw new ApiError("Camp not found", 404);
    }

    const data: Prisma.MedicalCampUpdateInput = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!CAMP_STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      if (status !== existing.status) {
        const allowed = TRANSITIONS[existing.status] ?? [];
        if (!allowed.includes(status)) {
          log.warn("medical_camp_invalid_transition", {
            campId: id,
            from: existing.status,
            to: status,
            actor: session.userId,
          });
          throw new ApiError(
            `Cannot move camp from ${existing.status} to ${status}`,
            409
          );
        }
        data.status = status;
      }
    }

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) throw new ApiError("title cannot be empty", 400);
      data.title = title;
    }
    if (body.description !== undefined) data.description = body.description ? String(body.description).trim() : null;
    if (body.campDate !== undefined) {
      const campDate = new Date(String(body.campDate));
      if (Number.isNaN(campDate.getTime()))
        throw new ApiError("campDate is not a valid date", 400);
      data.campDate = campDate;
    }
    if (body.startTime !== undefined) data.startTime = body.startTime ? String(body.startTime).trim() : null;
    if (body.endTime !== undefined) data.endTime = body.endTime ? String(body.endTime).trim() : null;
    if (body.venue !== undefined) {
      const venue = String(body.venue).trim();
      if (!venue) throw new ApiError("venue cannot be empty", 400);
      data.venue = venue;
    }
    if (body.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body.capacity !== undefined) {
      const capacity = Math.trunc(Number(body.capacity));
      if (!Number.isFinite(capacity) || capacity < 1)
        throw new ApiError("capacity must be a positive number", 400);
      data.capacity = capacity;
    }
    if (body.expectedCount !== undefined)
      data.expectedCount = body.expectedCount === null ? null : Math.trunc(Number(body.expectedCount));
    if (body.services !== undefined) data.services = stringList(body.services);
    if (body.coordinatorName !== undefined) data.coordinatorName = body.coordinatorName ? String(body.coordinatorName).trim() : null;
    if (body.budget !== undefined)
      data.budget = body.budget === null || String(body.budget).trim() === "" ? null : Number(body.budget);
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const camp = await db.medicalCamp.update({ where: { id }, data });
    log.info("medical_camp_updated", {
      campId: id,
      code: camp.code,
      fields: Object.keys(data),
      ...(body.status !== undefined ? { newStatus: camp.status } : {}),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "CAMP_UPDATE",
      "MedicalCamp",
      `${camp.code}${body.status !== undefined ? ` → ${camp.status}` : ""}`,
      session.userId
    );
    return json(res, camp);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/medical-camps/:id (ADMIN) — only DRAFT camps with no registrations
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.medicalCamp.findUnique({
      where: { id },
      include: { _count: { select: { registrations: true } } },
    });
    if (!existing) {
      log.warn("medical_camp_delete_not_found", { campId: id, actor: session.userId });
      throw new ApiError("Camp not found", 404);
    }
    if (existing.status !== "DRAFT") {
      log.warn("medical_camp_delete_blocked_status", {
        campId: id,
        status: existing.status,
        actor: session.userId,
      });
      throw new ApiError("Only camps in DRAFT status can be deleted", 409);
    }
    if (existing._count.registrations > 0) {
      log.warn("medical_camp_delete_blocked_registrations", {
        campId: id,
        registrations: existing._count.registrations,
        actor: session.userId,
      });
      throw new ApiError("This camp has registrations and cannot be deleted", 409);
    }

    await db.medicalCamp.delete({ where: { id } }); // partners + staff cascade

    log.info("medical_camp_deleted", {
      campId: id,
      code: existing.code,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_DELETE",
      "MedicalCamp",
      `${existing.code} — ${existing.title}`,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
