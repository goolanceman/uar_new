/**
 * Kit batch routes — /api/kit-batches, /api/kit-batches/:id
 * Converted 1:1 from src/app/api/kit-batches/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const router = Router();

const STATUSES = ["READY", "IN_PROGRESS", "DEPLETED"];

// GET /api/kit-batches?status= (auth)
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
    const status = sp.get("status") || undefined;

    const batches = await db.kitBatch.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        template: { select: { name: true, kind: true, codePrefix: true, costPerUnit: true, items: true } },
        _count: { select: { units: true } },
      },
    });
    return json(res, batches);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/kit-batches (ADMIN) — creates the batch + N QR-coded kit units
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const templateId = String(body.templateId ?? "");
    const name = String(body.name ?? "").trim();
    const totalUnits = Math.trunc(Number(body.totalUnits));

    if (!templateId) throw new ApiError("templateId is required", 400);
    if (!name) throw new ApiError("name is required", 400);
    if (!Number.isFinite(totalUnits) || totalUnits < 1 || totalUnits > 500)
      throw new ApiError("totalUnits must be between 1 and 500", 400);

    const template = await db.kitTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new ApiError("Template not found", 404);
    if (template.status === "RETIRED")
      throw new ApiError("Template is retired — pick an active one", 400);

    const PREFIX_BY_KIND: Record<string, string> = {
      RATION: "UAR-RK", FOOD: "UAR-FD", EDUCATION: "UAR-ED", MEDICAL: "UAR-MK",
      HYGIENE: "UAR-HK", CLOTHING: "UAR-CL", EMERGENCY: "UAR-EK", CUSTOM: "UAR-CK",
    };
    const codePrefix = template.codePrefix || PREFIX_BY_KIND[template.kind] || "UAR-KIT";

    // global running number = existing kit units + 1; loop until codes are unique
    const year = new Date().getFullYear();
    let base = await db.kitUnit.count();
    let codes: string[] = [];
    for (let guard = 0; guard < 25; guard++) {
      codes = Array.from({ length: totalUnits }, (_, i) =>
        `${codePrefix}-${year}-${String(base + i + 1).padStart(6, "0")}`
      );
      const clash = await db.kitUnit.findFirst({
        where: { code: { in: codes } },
        orderBy: { code: "desc" },
      });
      if (!clash) break;
      const n = parseInt(clash.code.split("-")[3] ?? "0", 10);
      base = Number.isFinite(n) && n >= base ? n : await db.kitUnit.count();
    }

    // Building a batch draws its template's component list from the master
    // inventory (totalUnits × qty per unit) — short of stock, the batch isn't
    // created at all. Components with no inventory match are skipped (legacy
    // free-text templates may not map 1:1 to the master).
    let templateItems: { itemId?: string; name: string; qty: number; unit?: string }[] = [];
    try {
      const parsed = JSON.parse(template.items);
      if (Array.isArray(parsed)) templateItems = parsed;
    } catch {
      templateItems = [];
    }

    const batch = await db.$transaction(async (tx) => {
      for (const line of templateItems) {
        const lineName = String(line?.name ?? "").trim();
        const lineQty = Number(line?.qty ?? 0);
        if ((!lineName && !line?.itemId) || !Number.isFinite(lineQty) || lineQty <= 0) continue;
        const needed = lineQty * totalUnits;
        const q = lineName.toLowerCase();
        // Prefer the explicit itemId saved by the template composer; fall back to
        // name matching for legacy free-text templates that predate itemId linking.
        const match =
          (line.itemId ? await tx.inventoryItem.findUnique({ where: { id: line.itemId } }) : null) ??
          (lineName ? await tx.inventoryItem.findFirst({ where: { name: { equals: lineName } } }) : null) ??
          (lineName ? await tx.inventoryItem.findFirst({ where: { name: { contains: q } } }) : null);
        if (!match) continue;
        if (match.quantity < needed)
          throw new ApiError(
            `Not enough "${match.name}" in stock to build ${totalUnits} kit(s) — needs ${needed} ${match.unit}, only ${match.quantity} ${match.unit} available`,
            400
          );
        await tx.inventoryItem.update({
          where: { id: match.id },
          data: { quantity: match.quantity - needed },
        });
        await tx.inventoryDistribution.create({
          data: {
            itemId: match.id,
            quantity: needed,
            notes: `Consumed building kit batch "${name}" (${template.name})`,
          },
        });
      }

      const created = await tx.kitBatch.create({
        data: {
          templateId,
          name,
          totalUnits,
          instructions: body.instructions ? String(body.instructions) : null,
          status: "READY",
        },
      });
      await tx.kitUnit.createMany({
        data: codes.map((code) => ({ batchId: created.id, code })),
      });
      return created;
    });

    const full = await db.kitBatch.findUnique({
      where: { id: batch.id },
      include: {
        template: { select: { name: true, kind: true, codePrefix: true, costPerUnit: true, items: true } },
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
    return json(res, { batch: full }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/kit-batches/:id (ADMIN) — {name?, instructions?, status?}
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const existing = await db.kitBatch.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Batch not found", 404);

    const data: Prisma.KitBatchUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.instructions !== undefined)
      data.instructions = body.instructions ? String(body.instructions) : null;
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status))
        throw new ApiError("status must be READY, IN_PROGRESS or DEPLETED", 400);
      // KitBatch.status is DERIVED from scanned-unit counts (kitBatchStatus in
      // @/lib/kit, written by /api/kit-scan) — manual moves would desync the
      // roll-up. Only an explicit no-op (same status) passes.
      if (status !== existing.status)
        throw new ApiError(
          `Kit batch status is derived from unit scans and cannot be set manually (current: ${existing.status})`,
          409
        );
    }

    const batch = await db.kitBatch.update({ where: { id }, data });
    await logActivity(
      session.name,
      "KIT_BATCH_UPDATE",
      "KitBatch",
      `${batch.name}${body.status !== undefined ? ` → ${batch.status}` : ""}`,
      session.userId
    );
    return json(res, batch);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/kit-batches/:id (ADMIN) — removes units then the batch
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.kitBatch.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Batch not found", 404);

    await db.kitUnit.deleteMany({ where: { batchId: id } });
    await db.kitBatch.delete({ where: { id } });

    await logActivity(
      session.name,
      "KIT_BATCH_DELETE",
      "KitBatch",
      existing.name,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
