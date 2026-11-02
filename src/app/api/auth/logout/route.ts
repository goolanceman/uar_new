import { clearSession, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await clearSession();
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
