/**
 * Testimonials routes — /api/testimonials, /api/testimonials/:id
 * Converted 1:1 from src/app/api/testimonials/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { cached, cacheTtl, catalogKey, invalidateCatalog } from "@/lib/cache";

export const router = Router();

const log = logger.child("testimonials");

// GET /api/testimonials — public wall
router.get("/", async (_req, res) => {
  try {
    const testimonials = await cached(catalogKey("testimonials", "wall"), cacheTtl.catalog, () =>
      db.testimonial.findMany({
        orderBy: { createdAt: "desc" },
        take: 12,
      })
    );
    return json(res, testimonials);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/testimonials — admin curates
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const name = String(body?.name ?? "").trim();
    const role = String(body?.role ?? "").trim();
    const message = String(body?.message ?? "").trim();
    if (!name || !role || !message)
      throw new ApiError("Name, role and message are required", 400);

    let rating = body?.rating !== undefined ? Number(body.rating) : 5;
    if (!Number.isFinite(rating)) rating = 5;
    rating = Math.min(5, Math.max(1, Math.round(rating)));

    const testimonial = await db.testimonial.create({
      data: { name, role, message, rating },
    });
    log.info("testimonial_created", {
      testimonialId: testimonial.id,
      name,
      rating,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "TESTIMONIAL_CREATE",
      "TESTIMONIAL",
      `${name} (${rating}★)`,
      session.userId
    );
    await invalidateCatalog("testimonials");

    return json(res, testimonial, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/testimonials/:id — admin edits
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.testimonial.findUnique({ where: { id } });
    if (!existing) {
      log.warn("testimonial_update_not_found", { testimonialId: id, actor: session.userId });
      throw new ApiError("Testimonial not found", 404);
    }

    const data: Record<string, unknown> = {};
    if (body?.name !== undefined) data.name = String(body.name).trim();
    if (body?.role !== undefined) data.role = String(body.role).trim();
    if (body?.message !== undefined) data.message = String(body.message).trim();
    if (body?.rating !== undefined) {
      let rating = Number(body.rating);
      if (!Number.isFinite(rating)) rating = 5;
      data.rating = Math.min(5, Math.max(1, Math.round(rating)));
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const testimonial = await db.testimonial.update({ where: { id }, data });
    log.info("testimonial_updated", {
      testimonialId: id,
      fields: Object.keys(data),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "TESTIMONIAL_UPDATE",
      "TESTIMONIAL",
      testimonial.name,
      session.userId
    );
    await invalidateCatalog("testimonials");

    return json(res, testimonial);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/testimonials/:id — admin removes
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;

    const existing = await db.testimonial.findUnique({ where: { id } });
    if (!existing) {
      log.warn("testimonial_delete_not_found", { testimonialId: id, actor: session.userId });
      throw new ApiError("Testimonial not found", 404);
    }

    await db.testimonial.delete({ where: { id } });
    log.info("testimonial_deleted", {
      testimonialId: id,
      name: existing.name,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "TESTIMONIAL_DELETE",
      "TESTIMONIAL",
      existing.name,
      session.userId
    );
    await invalidateCatalog("testimonials");

    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
