/**
 * Camp partner routes — /api/camp-partners, /api/camp-partners/:id
 * Converted 1:1 from src/app/api/camp-partners/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { PARTNER_RESPONSE_STATUSES, PARTNER_TRANSITIONS } from "@/lib/camp-partners";
import { assertTransition } from "@/lib/workflow";

export const router = Router();

const PARTNER_ROLES = ["HOST", "SUPPORT", "SPONSOR"];

const RESPONSE_STATUSES = PARTNER_RESPONSE_STATUSES;

function pageParams(sp: URLSearchParams) {
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const take = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "24", 10) || 24));
  return { page, take, skip: (page - 1) * take };
}

function envelope<T>(items: T[], total: number, page: number, take: number) {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

async function hospitalOrgId(userId: string): Promise<string | null> {
  const org = await db.healthcareOrg.findUnique({ where: { ownerUserId: userId } });
  return org?.id ?? null;
}

const INCLUDE = {
  camp: {
    select: { id: true, code: true, title: true, campDate: true, venue: true, city: true, status: true },
  },
  org: { select: { id: true, name: true, type: true, city: true, status: true } },
};

// GET /api/camp-partners?campId&status — ADMIN all; HOSPITAL its own invitations
router.get("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "HOSPITAL");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const campId = sp.get("campId") || undefined;
    const status = sp.get("status") || undefined;
    const { page, take, skip } = pageParams(sp);

    const where: Prisma.CampPartnerWhereInput = {};
    if (campId) where.campId = campId;
    if (status) where.status = status;
    if (session.role === "HOSPITAL") {
      const ownOrgId = await hospitalOrgId(session.userId);
      if (!ownOrgId) return json(res, envelope([], 0, page, take));
      where.orgId = ownOrgId;
    }

    const [items, total] = await Promise.all([
      db.campPartner.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: INCLUDE,
      }),
      db.campPartner.count({ where }),
    ]);
    return json(res, envelope(items, total, page, take));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/camp-partners (ADMIN) {campId, orgId, role} — invite an org (INVITED)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const campId = String(body.campId ?? "").trim();
    const orgId = String(body.orgId ?? "").trim();
    if (!campId) throw new ApiError("campId is required", 400);
    if (!orgId) throw new ApiError("orgId is required", 400);

    const camp = await db.medicalCamp.findUnique({ where: { id: campId } });
    if (!camp) throw new ApiError("Camp not found", 404);
    const org = await db.healthcareOrg.findUnique({ where: { id: orgId } });
    if (!org) throw new ApiError("Organisation not found", 404);

    const role = String(body.role ?? "SUPPORT").trim().toUpperCase();
    if (!PARTNER_ROLES.includes(role)) throw new ApiError("Invalid role", 400);

    const duplicate = await db.campPartner.findFirst({ where: { campId, orgId } });
    if (duplicate)
      throw new ApiError("This organisation is already a partner of this camp", 409);

    const partner = await db.campPartner.create({
      data: { campId, orgId, role, status: "INVITED" },
      include: INCLUDE,
    });

    await logActivity(
      session.name,
      "CAMP_PARTNER_ADD",
      "CampPartner",
      `${org.name} invited as ${role} for ${camp.title}`,
      session.userId
    );
    return json(res, partner, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/camp-partners/:id — ADMIN, or the HOSPITAL owning the invited org.
// {status: ACCEPTED|DECLINED, notes?} — respondedAt is stamped server-side.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "HOSPITAL");
    const { id } = req.params;
    const body = req.body ?? {};

    const partner = await db.campPartner.findUnique({
      where: { id },
      include: { camp: true, org: true },
    });
    if (!partner) throw new ApiError("Camp partner record not found", 404);

    if (session.role === "HOSPITAL" && partner.org.ownerUserId !== session.userId)
      throw new ApiError("You do not have permission for this action", 403);

    const data: { status?: string; notes?: string | null; respondedAt?: Date; role?: string } = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!RESPONSE_STATUSES.includes(status))
        throw new ApiError("status must be ACCEPTED or DECLINED", 400);
      assertTransition(PARTNER_TRANSITIONS, partner.status, status, "camp partner");
      data.status = status;
      data.respondedAt = new Date();
    }
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;
    if (session.role === "ADMIN" && body.role !== undefined) {
      const role = String(body.role).trim().toUpperCase();
      if (!["HOST", "SUPPORT", "SPONSOR"].includes(role))
        throw new ApiError("Invalid role", 400);
      data.role = role;
    }

    const updated = await db.campPartner.update({
      where: { id },
      data,
      include: {
        camp: { select: { id: true, code: true, title: true, campDate: true, venue: true, city: true, status: true } },
        org: { select: { id: true, name: true, type: true, city: true, status: true } },
      },
    });

    await logActivity(
      session.name,
      "CAMP_PARTNER_RESPOND",
      "CampPartner",
      `${updated.org.name} ${updated.status.toLowerCase()} invitation for ${updated.camp.title}`,
      session.userId
    );
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});
