import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/volunteer-applications/mine — latest application of the signed-in user
export async function GET() {
  try {
    const session = await requireAuth();
    const application = await db.volunteerApplication.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
    });
    return json({ application: application ?? null });
  } catch (e) {
    return handleError(e);
  }
}
