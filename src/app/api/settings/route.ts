import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireRole, ApiError, json, handleError, logActivity } from "@/lib/session";

export const dynamic = "force-dynamic";

async function allSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany({ orderBy: { key: "asc" } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// GET /api/settings — {key: value}
export async function GET() {
  try {
    return json(await allSettings());
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/settings — flat {key: value, …} → upsert each
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const entries = Object.entries(body ?? {}).filter(([key]) => key && typeof key === "string");
    if (entries.length === 0) throw new ApiError("Nothing to update", 400);

    for (const [key, raw] of entries) {
      const value = raw === null || raw === undefined ? "" : String(raw);
      await db.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }

    await logActivity(
      session.name,
      "SETTINGS_UPDATE",
      "SETTING",
      entries.map(([k]) => k).join(", ").slice(0, 200),
      session.userId
    );

    return json(await allSettings());
  } catch (e) {
    return handleError(e);
  }
}
