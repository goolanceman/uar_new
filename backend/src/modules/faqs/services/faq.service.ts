/**
 * FAQ service — all business rules for the FAQ catalog. Depends on the
 * repository contract, throws application errors, never touches HTTP.
 *
 * Every mutation drops the faqs catalog cache, exactly like the legacy
 * routes did (admin CRUD gate lives at the route/middleware layer).
 */
import { logger } from "@/lib/logger";
import { cached, cacheKeyPart, cacheTtl, catalogKey, invalidateCatalog } from "@/lib/cache";
import { paged } from "@/lib/community/serializers";
import { ApiError, NotFoundError, ConflictError } from "@/shared/errors";
import type { Session } from "@/lib/session";
import type { FaqRepository, FaqTypeWithFaqs } from "../repositories/faq.repository.interface";

const log = logger.child("faqs");

export interface PagedFaqs {
  items: Array<{
    id: number;
    title: string;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
    faqs: Array<{
      id: number;
      faqsTypeId: number;
      question: string;
      answer: string;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }>;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export class FaqService {
  constructor(private readonly faqRepository: FaqRepository) {}

  /** Public FAQ catalog (cached) — types with nested questions/answers. */
  async list(skip: number, page: number, limit: number): Promise<PagedFaqs> {
    const load = async (): Promise<PagedFaqs> => {
      const { rows, total } = await this.faqRepository.listTypesWithFaqs(skip, limit);
      return this.toPaged(rows, page, limit, total);
    };
    return cached(catalogKey("faqs", cacheKeyPart({ page, limit })), cacheTtl.catalog, load);
  }

  async createType(title: string, actor: Session): Promise<{ id: number; title: string }> {
    const dup = await this.faqRepository.findTypeByTitle(title);
    if (dup) {
      log.warn("faq_type_conflict", { title, actor: actor.userId });
      throw new ConflictError(`FAQ type "${title}" already exists`);
    }
    const row = await this.faqRepository.createType(title);
    await invalidateCatalog("faqs");
    log.info("faq_type_created", { typeId: row.id, title, actor: actor.userId });
    return row;
  }

  async updateType(id: number, title: string, actor: Session): Promise<{ id: number; title: string }> {
    const row = await this.faqRepository.findTypeById(id);
    if (!row) {
      log.warn("faq_type_update_not_found", { typeId: id, actor: actor.userId });
      throw new NotFoundError("FAQ type not found");
    }
    const dup = await this.faqRepository.findTypeByTitle(title);
    if (dup && dup.id !== id) {
      log.warn("faq_type_conflict", { typeId: id, title, actor: actor.userId });
      throw new ConflictError(`FAQ type "${title}" already exists`);
    }
    const updated = await this.faqRepository.updateType(id, title);
    await invalidateCatalog("faqs");
    log.info("faq_type_updated", { typeId: id, title, actor: actor.userId });
    return updated;
  }

  async deleteType(id: number, actor: Session): Promise<{ id: number; deleted: boolean }> {
    const row = await this.faqRepository.findTypeById(id);
    if (!row) {
      log.warn("faq_type_delete_not_found", { typeId: id, actor: actor.userId });
      throw new NotFoundError("FAQ type not found");
    }
    await this.faqRepository.deleteFaqsOfType(id);
    await this.faqRepository.softDeleteType(id);
    await invalidateCatalog("faqs");
    log.info("faq_type_deleted", { typeId: id, title: row.title, actor: actor.userId });
    return { id, deleted: true };
  }

  async createFaq(
    data: { faqsTypeId: number; question: string; answer: string },
    actor: Session
  ): Promise<{ id: number; faqsTypeId: number; question: string; answer: string }> {
    const type = await this.faqRepository.findTypeById(data.faqsTypeId);
    if (!type) {
      log.warn("faq_type_not_found", { faqsTypeId: data.faqsTypeId, actor: actor.userId });
      throw new NotFoundError("FAQ type not found");
    }
    const row = await this.faqRepository.createFaq(data);
    await invalidateCatalog("faqs");
    log.info("faq_created", { faqId: row.id, faqsTypeId: row.faqsTypeId, actor: actor.userId });
    return row;
  }

  async updateFaq(
    id: number,
    patch: { question?: string; answer?: string; faqsTypeId?: number },
    actor: Session
  ): Promise<{ id: number; faqsTypeId: number; question: string; answer: string }> {
    const row = await this.faqRepository.findFaqById(id);
    if (!row) {
      log.warn("faq_update_not_found", { faqId: id, actor: actor.userId });
      throw new NotFoundError("FAQ not found");
    }
    if (patch.faqsTypeId !== undefined) {
      const type = await this.faqRepository.findTypeById(patch.faqsTypeId);
      if (!type) {
        log.warn("faq_type_not_found", { faqId: id, faqsTypeId: patch.faqsTypeId, actor: actor.userId });
        throw new NotFoundError("FAQ type not found");
      }
    }
    const updated = await this.faqRepository.updateFaq(id, patch);
    await invalidateCatalog("faqs");
    log.info("faq_updated", { faqId: id, fields: Object.keys(patch), actor: actor.userId });
    return updated;
  }

  async deleteFaq(id: number, actor: Session): Promise<{ id: number; deleted: boolean }> {
    const row = await this.faqRepository.findFaqById(id);
    if (!row) {
      log.warn("faq_delete_not_found", { faqId: id, actor: actor.userId });
      throw new NotFoundError("FAQ not found");
    }
    await this.faqRepository.deleteFaq(id);
    await invalidateCatalog("faqs");
    log.info("faq_deleted", { faqId: id, question: row.question, actor: actor.userId });
    return { id, deleted: true };
  }

  /** Wire mapping + pagination envelope, identical to the legacy loader. */
  private toPaged(rows: FaqTypeWithFaqs[], page: number, limit: number, total: number): PagedFaqs {
    return paged(
      rows.map((t) => ({
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
    ) as PagedFaqs;
  }
}
