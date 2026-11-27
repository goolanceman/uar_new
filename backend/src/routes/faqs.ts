/**
 * FAQs routes — /api/faqs (shared by web + mobile).
 * Generic REST port of the legacy mobile fetchFAQs handler: FAQ types with
 * their nested faqs, soft-deleted types excluded.
 * Admin CRUD (legacy FAQsController add/update/delete for types + faqs) is
 * gated to ADMIN/MODERATOR; every mutation drops the faqs catalog cache.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ApiError, json, handleError } from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import { requireElevated } from "@/lib/community/admin";
import { cached, cacheKeyPart, cacheTtl, catalogKey, invalidateCatalog } from "@/lib/cache";

export const router = Router();

const log = logger.child("faqs");

// GET /api/faqs — FAQ categories (types) with nested questions/answers.
router.get("/", async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query);
    const payload = await cached(catalogKey("faqs", cacheKeyPart({ page, limit })), cacheTtl.catalog, () =>
      loadFaqs(skip, page, limit)
    );
    return json(res, payload);
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── Admin CRUD — FAQ types ───────────────────────────────────────────────

// POST /api/faqs/types {title}
router.post("/types", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    if (title.length > 55) throw new ApiError("The title may be at most 55 characters.", 400);
    const dup = await db.faqType.findFirst({ where: { title, isDeleted: 0 }, select: { id: true } });
    if (dup) {
      log.warn("faq_type_conflict", { title, actor: session.userId });
      throw new ApiError(`FAQ type "${title}" already exists`, 409);
    }
    const row = await db.faqType.create({ data: { title } });
    await invalidateCatalog("faqs");
    log.info("faq_type_created", { typeId: row.id, title, actor: session.userId });
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/faqs/types/:id {title}
router.patch("/types/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const id = Number((req.params as Record<string, string>).id);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!Number.isInteger(id)) throw new ApiError("Invalid FAQ type id", 400);
    if (!title) throw new ApiError("The title field is required.", 400);
    if (title.length > 55) throw new ApiError("The title may be at most 55 characters.", 400);
    const row = await db.faqType.findFirst({ where: { id, isDeleted: 0 } });
    if (!row) {
      log.warn("faq_type_update_not_found", { typeId: id, actor: session.userId });
      throw new ApiError("FAQ type not found", 404);
    }
    const dup = await db.faqType.findFirst({ where: { title, isDeleted: 0, id: { not: id } }, select: { id: true } });
    if (dup) {
      log.warn("faq_type_conflict", { typeId: id, title, actor: session.userId });
      throw new ApiError(`FAQ type "${title}" already exists`, 409);
    }
    const updated = await db.faqType.update({ where: { id }, data: { title } });
    await invalidateCatalog("faqs");
    log.info("faq_type_updated", { typeId: id, title, actor: session.userId });
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/faqs/types/:id — soft-delete the type and hard-delete its faqs
// (the legacy type delete emptied the section).
router.delete("/types/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id)) throw new ApiError("Invalid FAQ type id", 400);
    const row = await db.faqType.findFirst({ where: { id, isDeleted: 0 } });
    if (!row) {
      log.warn("faq_type_delete_not_found", { typeId: id, actor: session.userId });
      throw new ApiError("FAQ type not found", 404);
    }
    await db.faq.deleteMany({ where: { faqsTypeId: id } });
    await db.faqType.update({ where: { id }, data: { isDeleted: 1 } });
    await invalidateCatalog("faqs");
    log.info("faq_type_deleted", { typeId: id, title: row.title, actor: session.userId });
    return json(res, { id, deleted: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── Admin CRUD — FAQs ──────────────────────────────────────────────────

// POST /api/faqs {faqsTypeId, question, answer}
router.post("/", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const body = req.body ?? {};
    const faqsTypeId = Number(body.faqsTypeId);
    const question = String(body.question ?? "").trim();
    const answer = String(body.answer ?? "").trim();
    if (!Number.isInteger(faqsTypeId)) throw new ApiError("The faqsTypeId field is required.", 400);
    if (!question) throw new ApiError("The question field is required.", 400);
    if (!answer) throw new ApiError("The answer field is required.", 400);
    const type = await db.faqType.findFirst({ where: { id: faqsTypeId, isDeleted: 0 }, select: { id: true } });
    if (!type) {
      log.warn("faq_type_not_found", { faqsTypeId, actor: session.userId });
      throw new ApiError("FAQ type not found", 404);
    }
    const row = await db.faq.create({ data: { faqsTypeId, question, answer } });
    await invalidateCatalog("faqs");
    log.info("faq_created", { faqId: row.id, faqsTypeId, actor: session.userId });
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/faqs/:id {question?, answer?, faqsTypeId?}
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id)) throw new ApiError("Invalid FAQ id", 400);
    const row = await db.faq.findUnique({ where: { id } });
    if (!row) {
      log.warn("faq_update_not_found", { faqId: id, actor: session.userId });
      throw new ApiError("FAQ not found", 404);
    }

    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (body.question !== undefined) {
      const question = String(body.question ?? "").trim();
      if (!question) throw new ApiError("The question field is required.", 400);
      patch.question = question;
    }
    if (body.answer !== undefined) {
      const answer = String(body.answer ?? "").trim();
      if (!answer) throw new ApiError("The answer field is required.", 400);
      patch.answer = answer;
    }
    if (body.faqsTypeId !== undefined) {
      const faqsTypeId = Number(body.faqsTypeId);
      if (!Number.isInteger(faqsTypeId)) throw new ApiError("Invalid faqsTypeId", 400);
      const type = await db.faqType.findFirst({ where: { id: faqsTypeId, isDeleted: 0 }, select: { id: true } });
      if (!type) {
        log.warn("faq_type_not_found", { faqId: id, faqsTypeId, actor: session.userId });
        throw new ApiError("FAQ type not found", 404);
      }
      patch.faqsTypeId = faqsTypeId;
    }
    if (Object.keys(patch).length === 0) throw new ApiError("Nothing to update", 400);

    const updated = await db.faq.update({ where: { id }, data: patch });
    await invalidateCatalog("faqs");
    log.info("faq_updated", { faqId: id, fields: Object.keys(patch), actor: session.userId });
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/faqs/:id
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id)) throw new ApiError("Invalid FAQ id", 400);
    const row = await db.faq.findUnique({ where: { id } });
    if (!row) {
      log.warn("faq_delete_not_found", { faqId: id, actor: session.userId });
      throw new ApiError("FAQ not found", 404);
    }
    await db.faq.delete({ where: { id } });
    await invalidateCatalog("faqs");
    log.info("faq_deleted", { faqId: id, question: row.question, actor: session.userId });
    return json(res, { id, deleted: true });
  } catch (e) {
    return handleError(e, res);
  }
});

async function loadFaqs(skip: number, page: number, limit: number) {
    const where = { isDeleted: 0 };
    const [types, total] = await Promise.all([
      db.faqType.findMany({
        where,
        include: { faqs: true },
        orderBy: { id: "asc" },
        skip,
        take: limit,
      }),
      db.faqType.count({ where }),
    ]);
    return paged(
        types.map((t) => ({
          id: t.id,
          title: t.title,
          isDeleted: t.isDeleted === 1,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          faqs: t.faqs.map((f) => ({
            id: f.id,
            faqsTypeId: f.faqsTypeId,
            question: f.question,
            answer: f.answer,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          })),
        })),
        page,
        limit,
        total
    );
}
