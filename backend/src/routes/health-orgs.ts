/**
 * Health organisation routes — /api/health-orgs, /api/health-orgs/:id
 * Converted 1:1 from src/app/api/health-orgs/* (Next.js route handlers) to Express.
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
import { ORG_STATUSES, ORG_TRANSITIONS } from "@/lib/health-orgs";
import { assertTransition } from "@/lib/workflow";

export const router = Router();

const ORG_TYPES = [
  "HOSPITAL", "CLINIC", "LAB", "MEDICAL_COLLEGE", "DENTAL", "EYE_CARE",
  "PHARMACY", "BLOOD_BANK", "PRACTITIONER", "CSR",
];

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

// GET /api/health-orgs — ADMIN sees all (q/status/type filters);
// HOSPITAL sees only the org it owns.
router.get("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "HOSPITAL");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const q = sp.get("q")?.trim() || undefined;
    const status = sp.get("status") || undefined;
    const type = sp.get("type") || undefined;
    const { page, take, skip } = pageParams(sp);

    const where: Prisma.HealthcareOrgWhereInput = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (q)
      where.OR = [
        { name: { contains: q } },
        { city: { contains: q } },
        { regNumber: { contains: q } },
      ];
    if (session.role === "HOSPITAL") {
      where.ownerUserId = session.userId;
      delete where.OR; // an owner sees exactly their org regardless of q
      delete where.status;
      delete where.type;
    }

    const [items, total] = await Promise.all([
      db.healthcareOrg.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { staff: true, campPartners: true } },
        },
      }),
      db.healthcareOrg.count({ where }),
    ]);
    return json(res, envelope(items, total, page, take));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/health-orgs (ADMIN) — orgs are created PENDING until verified.
// Public self-registration is intentionally NOT exposed on this endpoint.
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("name is required", 400);

    const type = String(body.type ?? "HOSPITAL").trim().toUpperCase();
    if (!ORG_TYPES.includes(type)) throw new ApiError("Invalid org type", 400);
    if (body.status && !ORG_STATUSES.includes(String(body.status).trim().toUpperCase()))
      throw new ApiError("Invalid status", 400);

    const email = body.email ? String(body.email).trim() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new ApiError("email is not a valid address", 400);

    const org = await db.healthcareOrg.create({
      data: {
        name,
        type,
        city: body.city ? String(body.city).trim() : null,
        address: body.address ? String(body.address).trim() : null,
        phone: body.phone ? String(body.phone).trim() : null,
        email,
        website: body.website ? String(body.website).trim() : null,
        regNumber: body.regNumber ? String(body.regNumber).trim() : null,
        licences: stringList(body.licences),
        services: stringList(body.services),
        facilities: body.facilities ? String(body.facilities).trim() : null,
        operatingHours: body.operatingHours ? String(body.operatingHours).trim() : null,
        notes: body.notes ? String(body.notes).trim() : null,
        status: "PENDING",
      },
    });

    await logActivity(
      session.name,
      "HEALTH_ORG_ADD",
      "HealthcareOrg",
      `${org.name} (${org.type})`,
      session.userId
    );
    return json(res, org, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/health-orgs/:id — ADMIN, or the HOSPITAL user that owns the org
router.get("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "HOSPITAL");
    const { id } = req.params;
    const org = await db.healthcareOrg.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        staff: { orderBy: { createdAt: "desc" } },
        _count: { select: { campPartners: true, referrals: true } },
      },
    });
    if (!org) throw new ApiError("Organisation not found", 404);
    if (session.role === "HOSPITAL" && org.ownerUserId !== session.userId)
      throw new ApiError("You do not have permission for this action", 403);
    return json(res, org);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/health-orgs/:id (ADMIN) — verification (status + verifiedByName/
// verifiedAt) or plain field edits.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.healthcareOrg.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Organisation not found", 404);

    const data: Prisma.HealthcareOrgUpdateInput = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!ORG_STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      assertTransition(ORG_TRANSITIONS, existing.status, status, "health org");
      data.status = status;
      // Verification events are stamped server-side — never trust the client.
      if (status === "VERIFIED" || status === "REJECTED") {
        data.verifiedByName = session.name;
        data.verifiedAt = new Date();
      } else {
        data.verifiedByName = null;
        data.verifiedAt = null;
      }
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("name cannot be empty", 400);
      data.name = name;
    }
    if (body.type !== undefined) data.type = String(body.type).trim().toUpperCase();
    if (body.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body.address !== undefined) data.address = body.address ? String(body.address).trim() : null;
    if (body.phone !== undefined) data.phone = body.phone ? String(body.phone).trim() : null;
    if (body.email !== undefined) data.email = body.email ? String(body.email).trim() : null;
    if (body.website !== undefined) data.website = body.website ? String(body.website).trim() : null;
    if (body.regNumber !== undefined) data.regNumber = body.regNumber ? String(body.regNumber).trim() : null;
    if (body.licences !== undefined) data.licences = stringList(body.licences);
    if (body.services !== undefined) data.services = stringList(body.services);
    if (body.facilities !== undefined) data.facilities = body.facilities ? String(body.facilities).trim() : null;
    if (body.operatingHours !== undefined) data.operatingHours = body.operatingHours ? String(body.operatingHours).trim() : null;
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const org = await db.healthcareOrg.update({ where: { id }, data });
    await logActivity(
      session.name,
      body.status !== undefined ? "HEALTH_ORG_VERIFY" : "HEALTH_ORG_UPDATE",
      "HealthcareOrg",
      `${org.name}${body.status !== undefined ? ` → ${org.status}` : ""}`,
      session.userId
    );
    return json(res, org);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/health-orgs/:id (ADMIN) — only when the org has no camp partnerships
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.healthcareOrg.findUnique({
      where: { id },
      include: { _count: { select: { campPartners: true } } },
    });
    if (!existing) throw new ApiError("Organisation not found", 404);
    if (existing._count.campPartners > 0)
      throw new ApiError(
        "This organisation has camp partnerships and cannot be deleted",
        409
      );

    // Release optional references so SQLite FKs stay satisfied
    await db.healthProfessional.updateMany({ where: { orgId: id }, data: { orgId: null } });
    await db.medicalReferral.updateMany({ where: { receivingOrgId: id }, data: { receivingOrgId: null } });
    await db.healthcareOrg.delete({ where: { id } });

    await logActivity(
      session.name,
      "HEALTH_ORG_DELETE",
      "HealthcareOrg",
      existing.name,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
