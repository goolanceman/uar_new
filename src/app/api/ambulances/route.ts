import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const TYPES = ["BLS", "ALS", "PTV", "NEONATAL"];
const STATUSES = ["AVAILABLE", "ON_MISSION", "MAINTENANCE"];
/** Same rule as client phoneRule() — kept in sync per conventions. */
const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

// GET /api/ambulances?status=&type=&q= (auth)
export async function GET(req: Request) {
  try {
    await requireAuth();
    const sp = new URL(req.url).searchParams;
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
    return json(ambulances);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/ambulances (ADMIN)
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

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
    return json(ambulance, 201);
  } catch (e) {
    return handleError(e);
  }
}
