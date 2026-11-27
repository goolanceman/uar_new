/**
 * Testimonial service — business rules for the public testimonial wall and
 * its admin curation. Depends on the repository contract, throws application
 * errors, never touches HTTP.
 *
 * Every mutation drops the testimonials catalog cache, exactly like the
 * legacy routes did, and the legacy side-effect order (log → logActivity →
 * cache invalidation) is preserved.
 */
import { logger } from "@/lib/logger";
import { cached, cacheTtl, catalogKey, invalidateCatalog } from "@/lib/cache";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import type {
  TestimonialCreateData,
  TestimonialRepository,
  TestimonialRow,
  TestimonialUpdateData,
} from "../repositories/testimonial.repository.interface";

const log = logger.child("testimonials");

export class TestimonialService {
  constructor(private readonly testimonialRepository: TestimonialRepository) {}

  /** GET /api/testimonials — public wall (cached). */
  async listWall(): Promise<TestimonialRow[]> {
    return cached(catalogKey("testimonials", "wall"), cacheTtl.catalog, () =>
      this.testimonialRepository.findWall()
    );
  }

  /** POST /api/testimonials — admin curates (body pre-validated by Zod). */
  async create(data: TestimonialCreateData, actor: Session): Promise<TestimonialRow> {
    const testimonial = await this.testimonialRepository.create(data);
    log.info("testimonial_created", {
      testimonialId: testimonial.id,
      name: data.name,
      rating: data.rating,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "TESTIMONIAL_CREATE",
      "TESTIMONIAL",
      `${data.name} (${data.rating}★)`,
      actor.userId
    );
    await invalidateCatalog("testimonials");

    return testimonial;
  }

  /**
   * PATCH /api/testimonials/:id — admin edits. Field coercion happens here
   * (after the existence lookup) to preserve the legacy 404-before-400
   * ordering and the "Nothing to update" contract.
   */
  async update(id: string, body: Record<string, unknown>, actor: Session): Promise<TestimonialRow> {
    const existing = await this.testimonialRepository.findById(id);
    if (!existing) {
      log.warn("testimonial_update_not_found", { testimonialId: id, actor: actor.userId });
      throw new ApiError("Testimonial not found", 404);
    }

    const data: TestimonialUpdateData = {};
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

    const testimonial = await this.testimonialRepository.update(id, data);
    log.info("testimonial_updated", {
      testimonialId: id,
      fields: Object.keys(data),
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "TESTIMONIAL_UPDATE",
      "TESTIMONIAL",
      testimonial.name,
      actor.userId
    );
    await invalidateCatalog("testimonials");

    return testimonial;
  }

  /** DELETE /api/testimonials/:id — admin removes. */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.testimonialRepository.findById(id);
    if (!existing) {
      log.warn("testimonial_delete_not_found", { testimonialId: id, actor: actor.userId });
      throw new ApiError("Testimonial not found", 404);
    }

    await this.testimonialRepository.delete(id);
    log.info("testimonial_deleted", {
      testimonialId: id,
      name: existing.name,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "TESTIMONIAL_DELETE",
      "TESTIMONIAL",
      existing.name,
      actor.userId
    );
    await invalidateCatalog("testimonials");

    return { ok: true };
  }
}
