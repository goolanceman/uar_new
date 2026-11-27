/**
 * Kit template routes — /api/kit-templates, /api/kit-templates/:id
 * Converted 1:1 from src/app/api/kit-templates/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { nextKitTemplateCode } from "@/lib/codes";

export const router = Router();

const log = logger.child("kit-templates");

// GET /api/kit-templates (auth) — incl. _count batches
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);
    const templates = await db.kitTemplate.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { batches: true } } },
    });
    return json(res, templates);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/kit-templates (ADMIN) — {name, description?, items:[{name,qty,unit}], costPerUnit}
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("name is required", 400);
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0)
      throw new ApiError("items must be a non-empty array", 400);

    const costPerUnit = Number(body.costPerUnit ?? 0) || 0;

    const KINDS = ["RATION","FOOD","EDUCATION","MEDICAL","HYGIENE","CLOTHING","EMERGENCY","CUSTOM"];
    const kindRaw = body.kind ? String(body.kind).toUpperCase() : "RATION";
    if (!KINDS.includes(kindRaw)) throw new ApiError("Invalid kit kind", 400);
    const codePrefix = body.codePrefix ? String(body.codePrefix).trim().toUpperCase() : null;

    const template = await db.kitTemplate.create({
      data: {
        code: await nextKitTemplateCode(),
        name,
        kind: kindRaw,
        codePrefix,
        description: body.description ? String(body.description) : null,
        image: body.image ? String(body.image).trim() : null,
        items: JSON.stringify(items),
        costPerUnit,
        status: body.status === "RETIRED" ? "RETIRED" : "ACTIVE",
      },
    });

    log.info("kit_template_created", {
      templateId: template.id,
      code: template.code,
      name: template.name,
      kind: template.kind,
      itemCount: items.length,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "KIT_TEMPLATE_ADD",
      "KitTemplate",
      `${name} (${items.length} items)`,
      session.userId
    );
    return json(res, template, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/kit-templates/:id (ADMIN)
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const existing = await db.kitTemplate.findUnique({ where: { id } });
    if (!existing) {
      log.warn("kit_template_update_not_found", { templateId: id, actor: session.userId });
      throw new ApiError("Template not found", 404);
    }

    const data: Prisma.KitTemplateUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.kind !== undefined) {
      const KINDS = ["RATION","FOOD","EDUCATION","MEDICAL","HYGIENE","CLOTHING","EMERGENCY","CUSTOM"];
      const k = String(body.kind).toUpperCase();
      if (!KINDS.includes(k)) throw new ApiError("Invalid kit kind", 400);
      data.kind = k;
    }
    if (body.codePrefix !== undefined)
      data.codePrefix = body.codePrefix ? String(body.codePrefix).trim().toUpperCase() : null;
    if (body.image !== undefined) data.image = body.image ? String(body.image).trim() : null;
    if (body.status !== undefined) {
      const st = String(body.status).toUpperCase();
      if (!["ACTIVE","RETIRED"].includes(st)) throw new ApiError("Invalid status", 400);
      data.status = st;
    }
    if (body.description !== undefined)
      data.description = body.description ? String(body.description) : null;
    if (body.items !== undefined) {
      if (!Array.isArray(body.items) || body.items.length === 0)
        throw new ApiError("items must be a non-empty array", 400);
      data.items = JSON.stringify(body.items);
    }
    if (body.costPerUnit !== undefined)
      data.costPerUnit = Number(body.costPerUnit) || 0;

    const template = await db.kitTemplate.update({ where: { id }, data });
    log.info("kit_template_updated", {
      templateId: id,
      name: template.name,
      status: template.status,
      fields: Object.keys(data),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "KIT_TEMPLATE_UPDATE",
      "KitTemplate",
      template.name,
      session.userId
    );
    return json(res, template);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/kit-templates/:id (ADMIN) — blocked when batches exist
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.kitTemplate.findUnique({
      where: { id },
      include: { _count: { select: { batches: true } } },
    });
    if (!existing) {
      log.warn("kit_template_delete_not_found", { templateId: id, actor: session.userId });
      throw new ApiError("Template not found", 404);
    }
    if (existing._count.batches > 0) {
      log.warn("kit_template_delete_blocked", {
        templateId: id,
        name: existing.name,
        batches: existing._count.batches,
        actor: session.userId,
      });
      throw new ApiError("Template has batches", 409);
    }

    await db.kitTemplate.delete({ where: { id } });
    log.info("kit_template_deleted", {
      templateId: id,
      name: existing.name,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "KIT_TEMPLATE_DELETE",
      "KitTemplate",
      existing.name,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
