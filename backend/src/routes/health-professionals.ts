/**
 * Health professional routes — /api/health-professionals, /api/health-professionals/:id
 * Converted 1:1 from src/app/api/health-professionals/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const router = Router();

const log = logger.child("health-professionals");

const KINDS = ["DOCTOR", "NURSE", "PHARMACIST", "LAB_TECH", "OTHER"];

const VERIFICATION_STATUSES: readonly string[] = ["PENDING", "VERIFIED", "REJECTED"];
const VERIFICATION_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["VERIFIED", "REJECTED"],
  VERIFIED: [],
  REJECTED: [],
};

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

// GET /api/health-professionals?q&kind&orgId&verificationStatus&active
// ADMIN: full directory. HOSPITAL: scoped to its own org.
router.get("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "HOSPITAL");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const q = sp.get("q")?.trim() || undefined;
    const kind = sp.get("kind") || undefined;
    const orgId = sp.get("orgId") || undefined;
    const verificationStatus = sp.get("verificationStatus") || undefined;
    const active = sp.get("active");
    const { page, take, skip } = pageParams(sp);

    const where: Prisma.HealthProfessionalWhereInput = {};
    if (kind) where.kind = kind;
    if (orgId) where.orgId = orgId;
    if (verificationStatus) where.verificationStatus = verificationStatus;
    if (active === "1") where.active = true;
    if (active === "0") where.active = false;
    if (q)
      where.OR = [
        { name: { contains: q } },
        { regNumber: { contains: q } },
        { speciality: { contains: q } },
        { phone: { contains: q } },
      ];
    if (session.role === "HOSPITAL") {
      const ownOrgId = await hospitalOrgId(session.userId);
      if (!ownOrgId) return json(res, envelope([], 0, page, take));
      where.orgId = ownOrgId;
    }

    const [items, total] = await Promise.all([
      db.healthProfessional.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          org: { select: { id: true, name: true, type: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      db.healthProfessional.count({ where }),
    ]);
    return json(res, envelope(items, total, page, take));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/health-professionals — ADMIN anywhere, HOSPITAL within its own
// org (orgId forced server-side). New professionals start PENDING; verify
// via PATCH.
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "HOSPITAL");
    const body = req.body ?? {};

    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("name is required", 400);

    const kind = String(body.kind ?? "DOCTOR").trim().toUpperCase();
    if (!KINDS.includes(kind)) throw new ApiError("Invalid kind", 400);

    let orgId = body.orgId ? String(body.orgId) : null;
    if (session.role === "HOSPITAL") {
      const ownOrgId = await hospitalOrgId(session.userId);
      if (!ownOrgId) {
        log.warn("health_professional_no_linked_org", { actor: session.userId });
        throw new ApiError("Your account is not linked to an organisation", 403);
      }
      orgId = ownOrgId;
    } else if (orgId) {
      const org = await db.healthcareOrg.findUnique({ where: { id: orgId } });
      if (!org) {
        log.warn("health_professional_org_not_found", { orgId, actor: session.userId });
        throw new ApiError("Organisation not found", 404);
      }
    }

    const email = body.email ? String(body.email).trim() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new ApiError("email is not a valid address", 400);

    let experienceYears: number | null = null;
    if (body.experienceYears !== undefined && body.experienceYears !== null && String(body.experienceYears).trim() !== "") {
      experienceYears = Math.trunc(Number(body.experienceYears));
      if (!Number.isFinite(experienceYears) || experienceYears < 0)
        throw new ApiError("experienceYears must be 0 or more", 400);
    }

    const professional = await db.healthProfessional.create({
      data: {
        name,
        kind,
        orgId,
        regNumber: body.regNumber ? String(body.regNumber).trim() : null,
        qualification: body.qualification ? String(body.qualification).trim() : null,
        speciality: body.speciality ? String(body.speciality).trim() : null,
        experienceYears,
        phone: body.phone ? String(body.phone).trim() : null,
        email,
        availability: body.availability ? String(body.availability) : null,
        verificationStatus: "PENDING",
        active: true,
      },
      include: { org: { select: { id: true, name: true } } },
    });

    log.info("health_professional_created", {
      professionalId: professional.id,
      kind: professional.kind,
      ...(professional.orgId ? { orgId: professional.orgId } : {}),
      verificationStatus: professional.verificationStatus,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "HEALTH_PRO_ADD",
      "HealthProfessional",
      `${professional.name} (${kind})`,
      session.userId
    );
    return json(res, professional, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/health-professionals/:id — ADMIN, or the HOSPITAL owning the pro's org
router.get("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "HOSPITAL");
    const { id } = req.params;
    const professional = await db.healthProfessional.findUnique({
      where: { id },
      include: {
        org: { select: { id: true, name: true, type: true, city: true } },
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { campStaff: true, encounters: true, appointments: true } },
      },
    });
    if (!professional) throw new ApiError("Professional not found", 404);
    if (session.role === "HOSPITAL") {
      const ownOrgId = await hospitalOrgId(session.userId);
      if (!ownOrgId || professional.orgId !== ownOrgId)
        throw new ApiError("You do not have permission for this action", 403);
    }
    return json(res, professional);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/health-professionals/:id
// ADMIN: full profile + verification (verificationStatus + verifiedByName/At).
// Owning HOSPITAL: profile fields only — cannot self-verify.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "HOSPITAL");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.healthProfessional.findUnique({ where: { id } });
    if (!existing) {
      log.warn("health_professional_update_not_found", {
        professionalId: id,
        actor: session.userId,
      });
      throw new ApiError("Professional not found", 404);
    }

    const isAdmin = session.role === "ADMIN";
    if (!isAdmin) {
      const ownOrgId = await hospitalOrgId(session.userId);
      if (!ownOrgId || existing.orgId !== ownOrgId) {
        log.warn("health_professional_update_forbidden", {
          professionalId: id,
          actor: session.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
    }

    if (!isAdmin && body.verificationStatus !== undefined) {
      log.warn("health_professional_verify_forbidden", {
        professionalId: id,
        actor: session.userId,
      });
      throw new ApiError("Only an administrator can verify a professional", 403);
    }

    const data: Prisma.HealthProfessionalUpdateInput = {};

    if (body.verificationStatus !== undefined) {
      const status = String(body.verificationStatus).trim().toUpperCase();
      if (!VERIFICATION_STATUSES.includes(status))
        throw new ApiError("Invalid verificationStatus", 400);
      if (status !== existing.verificationStatus && !(VERIFICATION_TRANSITIONS[existing.verificationStatus] ?? []).includes(status)) {
        log.warn("health_professional_invalid_verification_transition", {
          professionalId: id,
          from: existing.verificationStatus,
          to: status,
          actor: session.userId,
        });
        throw new ApiError(`Cannot move professional verification from ${existing.verificationStatus} to ${status}`, 409);
      }
      data.verificationStatus = status;
      data.verifiedByName = status === "PENDING" ? null : session.name;
      data.verifiedAt = status === "PENDING" ? null : new Date();
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("name cannot be empty", 400);
      data.name = name;
    }
    if (body.kind !== undefined) data.kind = String(body.kind).trim().toUpperCase();
    if (body.orgId !== undefined && isAdmin) {
      if (body.orgId) {
        const org = await db.healthcareOrg.findUnique({ where: { id: String(body.orgId) } });
        if (!org) {
          log.warn("health_professional_org_not_found", {
            orgId: String(body.orgId),
            professionalId: id,
            actor: session.userId,
          });
          throw new ApiError("Organisation not found", 404);
        }
        data.org = { connect: { id: String(body.orgId) } };
      } else {
        data.org = { disconnect: true };
      }
    }
    if (body.regNumber !== undefined) data.regNumber = body.regNumber ? String(body.regNumber).trim() : null;
    if (body.qualification !== undefined) data.qualification = body.qualification ? String(body.qualification).trim() : null;
    if (body.speciality !== undefined) data.speciality = body.speciality ? String(body.speciality).trim() : null;
    if (body.experienceYears !== undefined) {
      if (body.experienceYears === null || String(body.experienceYears).trim() === "") {
        data.experienceYears = null;
      } else {
        const years = Math.trunc(Number(body.experienceYears));
        if (!Number.isFinite(years) || years < 0)
          throw new ApiError("experienceYears must be 0 or more", 400);
        data.experienceYears = years;
      }
    }
    if (body.phone !== undefined) data.phone = body.phone ? String(body.phone).trim() : null;
    if (body.email !== undefined) data.email = body.email ? String(body.email).trim() : null;
    if (body.availability !== undefined) data.availability = body.availability ? String(body.availability) : null;
    if (body.active !== undefined) data.active = Boolean(body.active);

    const professional = await db.healthProfessional.update({
      where: { id },
      data,
      include: { org: { select: { id: true, name: true } } },
    });
    log.info("health_professional_updated", {
      professionalId: id,
      fields: Object.keys(data),
      ...(data.verificationStatus !== undefined
        ? { newVerificationStatus: professional.verificationStatus }
        : {}),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      body.verificationStatus !== undefined ? "HEALTH_PRO_VERIFY" : "HEALTH_PRO_UPDATE",
      "HealthProfessional",
      `${professional.name}${body.verificationStatus !== undefined ? ` → ${professional.verificationStatus}` : ""}`,
      session.userId
    );
    return json(res, professional);
  } catch (e) {
    return handleError(e, res);
  }
});
