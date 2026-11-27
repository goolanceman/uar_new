/**
 * FAQs routes — /api/faqs (shared by web + mobile).
 * Generic REST port of the legacy mobile fetchFAQs handler: FAQ types with
 * their nested faqs, soft-deleted types excluded.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { json, handleError } from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import { cached, cacheKeyPart, cacheTtl, catalogKey } from "@/lib/cache";

export const router = Router();

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
