import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireRole, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/activity-logs?limit=60 — admin audit trail
export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN");

    const sp = new URL(req.url).searchParams;
    const limit = sp.get("limit") ? parseInt(sp.get("limit")!, 10) : 60;

    const logs = await db.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      ...(limit > 0 ? { take: limit } : {}),
    });

    return json(logs);
  } catch (e) {
    return handleError(e);
  }
}
