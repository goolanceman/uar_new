import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/volunteers/me (auth)
// → { volunteer: profile incl tasks | null, application: latest VolunteerApplication | null }
export async function GET() {
  try {
    const session = await requireAuth();

    const volunteer = await db.volunteer.findUnique({
      where: { userId: session.userId },
      include: { tasks: { orderBy: { scheduledDate: "desc" } } },
    });

    const application = await db.volunteerApplication.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
    });

    return json({ volunteer: volunteer ?? null, application: application ?? null });
  } catch (e) {
    return handleError(e);
  }
}
