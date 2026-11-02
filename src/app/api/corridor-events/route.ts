import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/corridor-events?missionId=&limit= (auth) — desc createdAt
export async function GET(req: Request) {
  try {
    await requireAuth();
    const sp = new URL(req.url).searchParams;
    const missionId = sp.get("missionId") || undefined;
    const limit = Math.min(
      200,
      Math.max(1, Math.trunc(Number(sp.get("limit")) || 50))
    );

    const events = await db.corridorEvent.findMany({
      where: missionId ? { missionId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { mission: { select: { requestRef: true } } },
    });
    return json(events);
  } catch (e) {
    return handleError(e);
  }
}
