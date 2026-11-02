import { db } from "@/lib/db";
import { getSession, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return json({ user: null });

    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) return json({ user: null });

    const { password: _pw, ...userSafe } = user;
    return json({ user: userSafe });
  } catch (e) {
    return handleError(e);
  }
}
