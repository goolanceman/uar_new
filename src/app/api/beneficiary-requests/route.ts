import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getSession,
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/beneficiary-requests — admin queue, or ?mine=1 for the caller
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const mine = sp.get("mine") === "1";
    const status = sp.get("status");

    if (mine) {
      const s = await requireRole("BENEFICIARY", "DONOR", "VOLUNTEER", "ADMIN");
      const rows = await db.beneficiaryRequest.findMany({
        where: { userId: s.userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return json(rows);
    }

    await requireRole("ADMIN", "VOLUNTEER");
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const rows = await db.beneficiaryRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { beneficiary: { select: { id: true, name: true, city: true } } },
    });
    return json(rows);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/beneficiary-requests — beneficiary submits a help request
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json().catch(() => ({}));

    const name = String(body?.name ?? "").trim();
    const details = String(body?.details ?? "").trim();
    if (!name || !details)
      throw new ApiError("Name and request details are required", 400);

    const urgency = String(body?.urgency ?? "MEDIUM").toUpperCase();
    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(urgency))
      throw new ApiError("Invalid urgency level", 400);

    // Link to the caller's beneficiary record when one exists
    const linked = session
      ? await db.beneficiary.findUnique({ where: { userId: session.userId } })
      : null;

    const row = await db.beneficiaryRequest.create({
      data: {
        beneficiaryId: body?.beneficiaryId
          ? String(body.beneficiaryId)
          : linked?.id ?? null,
        userId: session?.userId ?? null,
        name,
        phone: body?.phone ? String(body.phone).trim() : null,
        category: body?.category ? String(body.category) : "OTHER",
        urgency,
        details,
      },
    });

    return json(row, 201);
  } catch (e) {
    return handleError(e);
  }
}
