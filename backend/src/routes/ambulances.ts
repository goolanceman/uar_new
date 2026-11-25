/**
 * Ambulances routes — /api/ambulances, /api/ambulances/:id
 * Converted 1:1 from src/app/api/ambulances/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { AMBULANCE_STATUSES } from "@/lib/ambulances";

export const router = Router();

const TYPES = ["BLS", "ALS", "PTV", "NEONATAL"];
const STATUSES = ["AVAILABLE", "ON_MISSION", "MAINTENANCE"];
/** Same rule as client phoneRule() — kept in sync per conventions. */
const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

// GET /api/ambulances?status=&type=&q= (auth)
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
    const status = sp.get("status") || undefined;
    const type = sp.get("type") || undefined;
    const q = sp.get("q")?.trim() || undefined;

    const where: Prisma.AmbulanceWhereInput = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (q)
      where.OR = [
        { code: { contains: q } },
        { base: { contains: q } },
        { driverName: { contains: q } },
      ];

    const ambulances = await db.ambulance.findMany({
      where,
      orderBy: { code: "asc" },
    });
    return json(res, ambulances);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/ambulances (ADMIN)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const code = String(body.code ?? "").trim().toUpperCase();
    const type = String(body.type ?? "").trim().toUpperCase() || "BLS";
    const status = String(body.status ?? "AVAILABLE").trim().toUpperCase();
    const base = String(body.base ?? "").trim();
    const driverName = String(body.driverName ?? "").trim();
    const driverPhone = body.driverPhone ? String(body.driverPhone).trim() : "";

    if (!code) throw new ApiError("code is required", 400);
    if (!TYPES.includes(type)) throw new ApiError("Invalid type", 400);
    if (!STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
    if (!base) throw new ApiError("base is required", 400);
    if (!driverName) throw new ApiError("driverName is required", 400);
    if (driverPhone && !PHONE_RE.test(driverPhone.replace(/[\s-]/g, "")))
      throw new ApiError("driverPhone must be a valid Indian mobile number", 400);

    const clash = await db.ambulance.findUnique({ where: { code } });
    if (clash) throw new ApiError("Ambulance code already exists", 409);

    const ambulance = await db.ambulance.create({
      data: {
        code,
        type,
        status,
        base,
        driverName,
        driverPhone: driverPhone || null,
        crew: body.crew ? String(body.crew).trim() : null,
        equipment: body.equipment ? String(body.equipment).trim() : null,
      },
    });

    await logActivity(
      session.name,
      "AMBULANCE_ADD",
      "Ambulance",
      `${code} (${type})`,
      session.userId
    );
    return json(res, ambulance, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/ambulances/:id (ADMIN)
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const existing = await db.ambulance.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Ambulance not found", 404);

    const data: Prisma.AmbulanceUpdateInput = {};
    if (body.code !== undefined) {
      const code = String(body.code).trim().toUpperCase();
      if (!code) throw new ApiError("code cannot be empty", 400);
      if (code !== existing.code) {
        const clash = await db.ambulance.findUnique({ where: { code } });
        if (clash) throw new ApiError("Ambulance code already exists", 409);
      }
      data.code = code;
    }
    if (body.type !== undefined) {
      const type = String(body.type).trim().toUpperCase();
      if (!["BLS", "ALS", "PTV", "NEONATAL"].includes(type))
        throw new ApiError("Invalid type", 400);
      data.type = type;
    }
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!AMBULANCE_STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      data.status = status;
    }
    if (body.base !== undefined) data.base = String(body.base).trim();
    if (body.driverName !== undefined)
      data.driverName = String(body.driverName).trim();
    if (body.driverPhone !== undefined)
      data.driverPhone = body.driverPhone ? String(body.driverPhone).trim() : null;
    if (body.crew !== undefined)
      data.crew = body.crew ? String(body.crew).trim() : null;
    if (body.equipment !== undefined)
      data.equipment = body.equipment ? String(body.equipment).trim() : null;

    const ambulance = await db.ambulance.update({ where: { id }, data });
    await logActivity(
      session.name,
      "AMBULANCE_UPDATE",
      "Ambulance",
      `${ambulance.code}${body.status !== undefined ? ` → ${ambulance.status}` : ""}`,
      session.userId
    );
    return json(res, ambulance);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/ambulances/:id (ADMIN) — blocked while ON_MISSION
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.ambulance.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Ambulance not found", 404);
    if (existing.status === "ON_MISSION")
      throw new ApiError("Ambulance is on a mission", 409);

    await db.ambulance.delete({ where: { id } });
    await logActivity(
      session.name,
      "AMBULANCE_DELETE",
      "Ambulance",
      existing.code,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
