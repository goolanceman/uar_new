import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireRole, ApiError, json, handleError, logActivity } from "@/lib/session";

export const dynamic = "force-dynamic";

const SECRET_PATTERN = /(secret|password|apikey|api_key|token|credential)/i;

function isSecretKey(key: string): boolean {
  return SECRET_PATTERN.test(key);
}

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 2)}${"•".repeat(Math.min(12, value.length - 4))}${value.slice(-2)}`;
}

// GET /api/settings — flat {key: value} (ADMIN only); secrets masked
export async function GET() {
  try {
    await requireRole("ADMIN");
    const rows = await db.setting.findMany({ orderBy: { key: "asc" } });
    // Ensure isSecret flag is backfilled for legacy rows matching the pattern
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.key] = r.isSecret || isSecretKey(r.key) ? maskValue(r.value) : r.value;
    }
    return json(out);
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/settings — flat {key: value, …} → upsert each (secrets stored as-is)
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const entries = Object.entries(body ?? {}).filter(
      ([key]) => key && typeof key === "string"
    );
    if (entries.length === 0) throw new ApiError("Nothing to update", 400);

    for (const [key, raw] of entries) {
      const value = raw === null || raw === undefined ? "" : String(raw);
      const secret = isSecretKey(key);
      await db.setting.upsert({
        where: { key },
        create: { key, value, isSecret: secret },
        update: { value, isSecret: secret },
      });
    }

    await logActivity(
      session.name,
      "SETTINGS_UPDATE",
      "SETTING",
      entries.map(([k]) => (isSecretKey(k) ? `${k}=***` : k)).join(", ").slice(0, 200),
      session.userId
    );

    const rows = await db.setting.findMany({ orderBy: { key: "asc" } });
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.key] = r.isSecret || isSecretKey(r.key) ? maskValue(r.value) : r.value;
    }
    return json(out);
  } catch (e) {
    return handleError(e);
  }
}
