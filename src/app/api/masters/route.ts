import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/masters
//   ?categories=1  → distinct category strings (orderBy category)
//   ?all=1 (ADMIN) → every master row
//   ?category=X    → active {value,label}[] ordered by sortOrder
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    if (sp.get("categories")) {
      const rows = await db.master.findMany({
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      });
      return json(rows.map((r) => r.category));
    }

    if (sp.get("all")) {
      await requireRole("ADMIN");
      const rows = await db.master.findMany({
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      });
      return json(rows);
    }

    const category = sp.get("category");
    if (!category) return json([]);

    const rows = await db.master.findMany({
      where: { category, active: true },
      orderBy: { sortOrder: "asc" },
      select: { value: true, label: true },
    });
    return json(rows);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/masters (ADMIN) — upsert by (category, value)
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const category = String(body.category ?? "").trim();
    const value = String(body.value ?? "").trim();
    const label = String(body.label ?? "").trim() || value;
    if (!category || !value)
      throw new ApiError("category and value are required", 400);
    const sortOrder = Number.isFinite(Number(body.sortOrder))
      ? Math.trunc(Number(body.sortOrder))
      : 0;

    const row = await db.master.upsert({
      where: { category_value: { category, value } },
      update: {
        label,
        sortOrder,
        ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
      },
      create: { category, value, label, sortOrder },
    });

    await logActivity(
      session.name,
      "MASTER_UPSERT",
      "Master",
      `${category}/${value}`,
      session.userId
    );
    return json(row, 201);
  } catch (e) {
    return handleError(e);
  }
}
