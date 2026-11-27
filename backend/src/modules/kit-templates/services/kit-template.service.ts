/**
 * Kit template service — all business rules for the kit template catalog.
 * Depends on the repository contract + the shared code generator, throws
 * application errors, never touches HTTP.
 */
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/session";
import { nextKitTemplateCode } from "@/lib/codes";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { Session } from "@/lib/session";
import type {
  KitTemplateCreateData,
  KitTemplateRepository,
  KitTemplateRow,
  KitTemplateUpdateData,
  KitTemplateWithCounts,
} from "../repositories/kit-template.repository.interface";

const log = logger.child("kit-templates");

export class KitTemplateService {
  constructor(private readonly kitTemplateRepository: KitTemplateRepository) {}

  /** GET /api/kit-templates (auth) — incl. _count batches. */
  async list(): Promise<KitTemplateWithCounts[]> {
    return this.kitTemplateRepository.list();
  }

  /** POST /api/kit-templates (ADMIN) — {name, description?, items:[{name,qty,unit}], costPerUnit}. */
  async create(
    data: Omit<KitTemplateCreateData, "code">,
    actor: Session
  ): Promise<KitTemplateRow> {
    // Unique template code generated at creation time (legacy: inside db.create).
    const template = await this.kitTemplateRepository.create({ ...data, code: await nextKitTemplateCode() });

    log.info("kit_template_created", {
      templateId: template.id,
      code: template.code,
      name: template.name,
      kind: template.kind,
      itemCount: data.items.length,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "KIT_TEMPLATE_ADD",
      "KitTemplate",
      `${data.name} (${data.items.length} items)`,
      actor.userId
    );
    return template;
  }

  /**
   * PATCH /api/kit-templates/:id (ADMIN). Builds the update payload in the
   * legacy key order (name, kind, codePrefix, image, status, description,
   * items, costPerUnit) so `fields: Object.keys(...)` logs identically.
   */
  async update(id: string, body: KitTemplateUpdateData, actor: Session): Promise<KitTemplateRow> {
    const existing = await this.kitTemplateRepository.findById(id);
    if (!existing) {
      log.warn("kit_template_update_not_found", { templateId: id, actor: actor.userId });
      throw new NotFoundError("Template not found");
    }

    const data: KitTemplateUpdateData = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.kind !== undefined) data.kind = body.kind;
    if (body.codePrefix !== undefined) data.codePrefix = body.codePrefix;
    if (body.image !== undefined) data.image = body.image;
    if (body.status !== undefined) data.status = body.status;
    if (body.description !== undefined) data.description = body.description;
    if (body.items !== undefined) data.items = body.items;
    if (body.costPerUnit !== undefined) data.costPerUnit = body.costPerUnit;

    const template = await this.kitTemplateRepository.update(id, data);
    log.info("kit_template_updated", {
      templateId: id,
      name: template.name,
      status: template.status,
      fields: Object.keys(data),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "KIT_TEMPLATE_UPDATE",
      "KitTemplate",
      template.name,
      actor.userId
    );
    return template;
  }

  /** DELETE /api/kit-templates/:id (ADMIN) — blocked when batches exist. */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.kitTemplateRepository.findByIdWithBatchCount(id);
    if (!existing) {
      log.warn("kit_template_delete_not_found", { templateId: id, actor: actor.userId });
      throw new NotFoundError("Template not found");
    }
    if (existing._count.batches > 0) {
      log.warn("kit_template_delete_blocked", {
        templateId: id,
        name: existing.name,
        batches: existing._count.batches,
        actor: actor.userId,
      });
      throw new ApiError("Template has batches", 409);
    }

    await this.kitTemplateRepository.remove(id);
    log.info("kit_template_deleted", {
      templateId: id,
      name: existing.name,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "KIT_TEMPLATE_DELETE",
      "KitTemplate",
      existing.name,
      actor.userId
    );
    return { ok: true };
  }
}
