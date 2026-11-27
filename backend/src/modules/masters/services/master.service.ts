/**
 * Master service — the category/value picklist catalog and its admin CRUD.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. Every read goes through the shared catalog cache, every
 * mutation drops it, and the legacy side-effect order (log → logActivity →
 * cache invalidation) is preserved.
 */
import { logger } from "@/infrastructure/logging/logger";
import { cached, cacheKeyPart, cacheTtl, catalogKey, invalidateCatalog } from "@/infrastructure/cache";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { ApiError } from "@/shared/errors";
import type {
  MasterRepository,
  MasterRow,
  MasterUpdateData,
} from "../repositories/master.repository.interface";

const log = logger.child("masters");

export class MasterService {
  constructor(private readonly masterRepository: MasterRepository) {}

  /** ?categories=1 — distinct category strings (cached). */
  async listCategories(): Promise<string[]> {
    const rows = await cached(catalogKey("masters", "categories"), cacheTtl.catalog, () =>
      this.masterRepository.listDistinctCategories()
    );
    return rows.map((r) => r.category);
  }

  /** ?all=1 (ADMIN) — every master row (cached). */
  async listAll(): Promise<MasterRow[]> {
    return cached(catalogKey("masters", "all"), cacheTtl.catalog, () =>
      this.masterRepository.listAll()
    );
  }

  /** ?category=X — active {value,label}[] ordered by sortOrder (cached). */
  async listByCategory(category: string): Promise<Array<{ value: string; label: string }>> {
    return cached(catalogKey("masters", cacheKeyPart({ category })), cacheTtl.catalog, () =>
      this.masterRepository.listByCategory(category)
    );
  }

  /** POST /api/masters — upsert by (category, value). Coercion happens here
   *  (after the route's ADMIN gate) with the exact legacy messages. */
  async upsert(body: Record<string, unknown>, actor: Session): Promise<MasterRow> {
    const category = String(body.category ?? "").trim();
    const value = String(body.value ?? "").trim();
    const label = String(body.label ?? "").trim() || value;
    if (!category || !value)
      throw new ApiError("category and value are required", 400);
    const sortOrder = Number.isFinite(Number(body.sortOrder))
      ? Math.trunc(Number(body.sortOrder))
      : 0;

    const row = await this.masterRepository.upsert({
      category,
      value,
      label,
      sortOrder,
      ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
    });

    log.info("master_upserted", {
      masterId: row.id,
      category,
      value,
      label,
      sortOrder,
      active: row.active,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "MASTER_UPSERT",
      "Master",
      `${category}/${value}`,
      actor.userId
    );
    await invalidateCatalog("masters");
    return row;
  }

  /**
   * PATCH /api/masters/:id — admin edits. Field coercion happens here
   * (after the existence lookup) to preserve the legacy 404-before-400
   * ordering, the "value cannot be empty" 400 and the 409 value conflict.
   */
  async update(id: string, body: Record<string, unknown>, actor: Session): Promise<MasterRow> {
    const existing = await this.masterRepository.findById(id);
    if (!existing) {
      log.warn("master_update_not_found", { masterId: id, actor: actor.userId });
      throw new ApiError("Master entry not found", 404);
    }

    const data: MasterUpdateData = {};
    if (body.label !== undefined) data.label = String(body.label).trim();
    if (body.sortOrder !== undefined)
      data.sortOrder = Number(body.sortOrder) || 0;
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.value !== undefined) {
      const value = String(body.value).trim();
      if (!value) throw new ApiError("value cannot be empty", 400);
      if (value !== existing.value) {
        const clash = await this.masterRepository.findByCategoryValue(existing.category, value);
        if (clash) {
          log.warn("master_value_conflict", {
            masterId: id,
            category: existing.category,
            value,
            existingId: clash.id,
            actor: actor.userId,
          });
          throw new ApiError(
            "A master entry with this value already exists in the category",
            409
          );
        }
      }
      data.value = value;
    }

    const row = await this.masterRepository.update(id, data);
    log.info("master_updated", {
      masterId: id,
      category: row.category,
      value: row.value,
      fields: Object.keys(data),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "MASTER_UPDATE",
      "Master",
      `${row.category}/${row.value}`,
      actor.userId
    );
    await invalidateCatalog("masters");
    return row;
  }

  /** DELETE /api/masters/:id — admin removes. */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const row = await this.masterRepository.findById(id);
    if (!row) {
      log.warn("master_delete_not_found", { masterId: id, actor: actor.userId });
      throw new ApiError("Master entry not found", 404);
    }

    await this.masterRepository.delete(id);
    log.info("master_deleted", {
      masterId: id,
      category: row.category,
      value: row.value,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "MASTER_DELETE",
      "Master",
      `${row.category}/${row.value}`,
      actor.userId
    );
    await invalidateCatalog("masters");
    return { ok: true };
  }
}
