import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/kit-batches?status= (auth)
export async function GET(req: Request) {
  try {
    await requireAuth();
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status") || undefined;

    const batches = await db.kitBatch.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        template: { select: { name: true, costPerUnit: true } },
        _count: { select: { units: true } },
      },
    });
    return json(batches);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/kit-batches (ADMIN) — creates the batch + N QR-coded kit units
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const templateId = String(body.templateId ?? "");
    const name = String(body.name ?? "").trim();
    const totalUnits = Math.trunc(Number(body.totalUnits));

    if (!templateId) throw new ApiError("templateId is required", 400);
    if (!name) throw new ApiError("name is required", 400);
    if (!Number.isFinite(totalUnits) || totalUnits < 1 || totalUnits > 500)
      throw new ApiError("totalUnits must be between 1 and 500", 400);

    const template = await db.kitTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new ApiError("Template not found", 404);

    // global running number = existing kit units + 1; loop until codes are unique
    const year = new Date().getFullYear();
    let base = await db.kitUnit.count();
    let codes: string[] = [];
    for (let guard = 0; guard < 25; guard++) {
      codes = Array.from({ length: totalUnits }, (_, i) =>
        `UAR-RK-${year}-${String(base + i + 1).padStart(6, "0")}`
      );
      const clash = await db.kitUnit.findFirst({
        where: { code: { in: codes } },
        orderBy: { code: "desc" },
      });
      if (!clash) break;
      const n = parseInt(clash.code.split("-")[3] ?? "0", 10);
      base = Number.isFinite(n) && n >= base ? n : await db.kitUnit.count();
    }

    const batch = await db.kitBatch.create({
      data: {
        templateId,
        name,
        totalUnits,
        instructions: body.instructions ? String(body.instructions) : null,
        status: "READY",
      },
    });
    await db.kitUnit.createMany({
      data: codes.map((code) => ({ batchId: batch.id, code })),
    });

    const full = await db.kitBatch.findUnique({
      where: { id: batch.id },
      include: {
        template: { select: { name: true, costPerUnit: true } },
        _count: { select: { units: true } },
      },
    });

    await logActivity(
      session.name,
      "KIT_BATCH",
      "KitBatch",
      `${name}: ${totalUnits} units (${template.name})`,
      session.userId
    );
    return json({ batch: full }, 201);
  } catch (e) {
    return handleError(e);
  }
}
