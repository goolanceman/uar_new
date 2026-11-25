/**
 * Masters routes — /api/masters, /api/masters/:id
 * Converted 1:1 from src/app/api/masters/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const router = Router();

// GET /api/masters
//   ?categories=1  → distinct category strings (orderBy category)
//   ?all=1 (ADMIN) → every master row
//   ?category=X    → active {value,label}[] ordered by sortOrder
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;

    if (sp.get("categories")) {
      const rows = await db.master.findMany({
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      });
      return json(res, rows.map((r) => r.category));
    }

    if (sp.get("all")) {
      await requireRole(req, "ADMIN");
      const rows = await db.master.findMany({
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      });
      return json(res, rows);
    }

    const category = sp.get("category");
    if (!category) return json(res, []);

    const rows = await db.master.findMany({
      where: { category, active: true },
      orderBy: { sortOrder: "asc" },
      select: { value: true, label: true },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/masters (ADMIN) — upsert by (category, value)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body as Record<string, unknown>;

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
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/masters/:id (ADMIN) — {label?, active?, sortOrder?, value?}
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;

    const existing = await db.master.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Master entry not found", 404);

    const data: Prisma.MasterUpdateInput = {};
    if (body.label !== undefined) data.label = String(body.label).trim();
    if (body.sortOrder !== undefined)
      data.sortOrder = Number(body.sortOrder) || 0;
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.value !== undefined) {
      const value = String(body.value).trim();
      if (!value) throw new ApiError("value cannot be empty", 400);
      if (value !== existing.value) {
        const clash = await db.master.findUnique({
          where: { category_value: { category: existing.category, value } },
        });
        if (clash)
          throw new ApiError(
            "A master entry with this value already exists in the category",
            409
          );
      }
      data.value = value;
    }

    const row = await db.master.update({ where: { id }, data });
    await logActivity(
      session.name,
      "MASTER_UPDATE",
      "Master",
      `${row.category}/${row.value}`,
      session.userId
    );
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/masters/:id (ADMIN)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const row = await db.master.findUnique({ where: { id } });
    if (!row) throw new ApiError("Master entry not found", 404);

    await db.master.delete({ where: { id } });
    await logActivity(
      session.name,
      "MASTER_DELETE",
      "Master",
      `${row.category}/${row.value}`,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
