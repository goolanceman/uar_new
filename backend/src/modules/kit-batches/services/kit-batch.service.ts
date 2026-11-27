/**
 * Kit batch service — batch building rules: stock consumption from the master
 * inventory, sequential QR-code allocation and the derived-status guard.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP.
 *
 * The legacy handlers validated body fields mid-handler after the auth gate
 * (with the template lookup interleaved — 404-before-400 ordering), so those
 * checks and their exact messages live here instead of in a route-level Zod
 * schema.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import type {
  KitBatchRepository,
  KitBatchRow,
  KitBatchWithTemplate,
  StockMatch,
} from "../repositories/kit-batch.repository.interface";
import type { CreateKitBatchBody, ListKitBatchesQuery, UpdateKitBatchBody } from "../schemas/kit-batch.schema";

const log = logger.child("kit-batches");

const STATUSES = ["READY", "IN_PROGRESS", "DEPLETED"];

const PREFIX_BY_KIND: Record<string, string> = {
  RATION: "UAR-RK", FOOD: "UAR-FD", EDUCATION: "UAR-ED", MEDICAL: "UAR-MK",
  HYGIENE: "UAR-HK", CLOTHING: "UAR-CL", EMERGENCY: "UAR-EK", CUSTOM: "UAR-CK",
};

export class KitBatchService {
  constructor(private readonly kitBatchRepository: KitBatchRepository) {}

  /** GET /api/kit-batches?status= — newest first, incl. template + unit count. */
  async list(query: ListKitBatchesQuery): Promise<KitBatchWithTemplate[]> {
    return this.kitBatchRepository.listBatches(query.status);
  }

  /**
   * POST /api/kit-batches (ADMIN) — creates the batch + N QR-coded kit units
   * (global running number, skipping collisions) after reserving the
   * template's components from master inventory.
   */
  async create(body: CreateKitBatchBody, actor: Session): Promise<KitBatchWithTemplate | null> {
    const templateId = String(body.templateId ?? "");
    const name = String(body.name ?? "").trim();
    const totalUnits = Math.trunc(Number(body.totalUnits));

    if (!templateId) throw new ApiError("templateId is required", 400);
    if (!name) throw new ApiError("name is required", 400);
    if (!Number.isFinite(totalUnits) || totalUnits < 1 || totalUnits > 500)
      throw new ApiError("totalUnits must be between 1 and 500", 400);

    const template = await this.kitBatchRepository.findTemplateById(templateId);
    if (!template) {
      log.warn("kit_batch_template_not_found", { templateId, actor: actor.userId });
      throw new ApiError("Template not found", 404);
    }
    if (template.status === "RETIRED") {
      log.warn("kit_batch_template_retired", {
        templateId,
        templateName: template.name,
        actor: actor.userId,
      });
      throw new ApiError("Template is retired — pick an active one", 400);
    }

    const codePrefix = template.codePrefix || PREFIX_BY_KIND[template.kind] || "UAR-KIT";

    // global running number = existing kit units + 1; loop until codes are unique
    const year = new Date().getFullYear();
    let base = await this.kitBatchRepository.countKitUnits();
    let codes: string[] = [];
    for (let guard = 0; guard < 25; guard++) {
      codes = Array.from({ length: totalUnits }, (_, i) =>
        `${codePrefix}-${year}-${String(base + i + 1).padStart(6, "0")}`
      );
      const clash = await this.kitBatchRepository.findUnitCodeClash(codes);
      if (!clash) break;
      const n = parseInt(clash.code.split("-")[3] ?? "0", 10);
      base = Number.isFinite(n) && n >= base ? n : await this.kitBatchRepository.countKitUnits();
    }

    let templateItems: { itemId?: string; name: string; qty: number; unit?: string }[] = [];
    try {
      const parsed = JSON.parse(template.items);
      if (Array.isArray(parsed)) templateItems = parsed;
    } catch {
      templateItems = [];
    }
    // Normalize the template lines for the transaction: drop blank/invalid
    // rows (legacy `continue` conditions), scale qty by totalUnits.
    const lines = templateItems
      .map((line) => ({
        itemId: line?.itemId,
        lineName: String(line?.name ?? "").trim(),
        lineQty: Number(line?.qty ?? 0),
      }))
      .filter((l) => !((!l.lineName && !l.itemId) || !Number.isFinite(l.lineQty) || l.lineQty <= 0))
      .map((l) => ({ itemId: l.itemId, name: l.lineName, needed: l.lineQty * totalUnits }));

    const assertStock = (match: StockMatch, needed: number): void => {
      if (match.quantity < needed) {
        log.warn("kit_batch_insufficient_stock", {
          templateId,
          batchName: name,
          itemId: match.id,
          itemName: match.name,
          needed,
          available: match.quantity,
          totalUnits,
          actor: actor.userId,
        });
        throw new ApiError(
          `Not enough "${match.name}" in stock to build ${totalUnits} kit(s) — needs ${needed} ${match.unit}, only ${match.quantity} ${match.unit} available`,
          400
        );
      }
    };

    const batch = await this.kitBatchRepository.createBatchWithUnits(
      {
        templateId,
        name,
        totalUnits,
        instructions: body.instructions ? String(body.instructions) : null,
        templateName: template.name,
        codes,
        lines,
      },
      assertStock
    );

    const full = await this.kitBatchRepository.findBatchWithTemplate(batch.id);

    log.info("kit_batch_created", {
      batchId: batch.id,
      name,
      totalUnits,
      templateId,
      templateName: template.name,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "KIT_BATCH",
      "KitBatch",
      `${name}: ${totalUnits} units (${template.name})`,
      actor.userId
    );
    return full;
  }

  /**
   * PATCH /api/kit-batches/:id (ADMIN) — {name?, instructions?, status?}.
   * Status is DERIVED from scanned-unit counts (written by /api/kit-scan) —
   * manual moves would desync the roll-up, so only a no-op passes.
   */
  async update(id: string, body: UpdateKitBatchBody, actor: Session): Promise<KitBatchRow> {
    const existing = await this.kitBatchRepository.findBatchById(id);
    if (!existing) {
      log.warn("kit_batch_update_not_found", { batchId: id, actor: actor.userId });
      throw new ApiError("Batch not found", 404);
    }

    const data: { name?: string; instructions?: string | null } = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.instructions !== undefined)
      data.instructions = body.instructions ? String(body.instructions) : null;
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status))
        throw new ApiError("status must be READY, IN_PROGRESS or DEPLETED", 400);
      // KitBatch.status is DERIVED from scanned-unit counts (kitBatchStatus in
      // @/modules/kit-scan/services/kit.domain, written by /api/kit-scan) — manual moves would desync the
      // roll-up. Only an explicit no-op (same status) passes.
      if (status !== existing.status) {
        log.warn("kit_batch_status_manual_blocked", {
          batchId: id,
          name: existing.name,
          currentStatus: existing.status,
          requestedStatus: status,
          actor: actor.userId,
        });
        throw new ApiError(
          `Kit batch status is derived from unit scans and cannot be set manually (current: ${existing.status})`,
          409
        );
      }
    }

    const batch = await this.kitBatchRepository.update(id, data);
    log.info("kit_batch_updated", {
      batchId: id,
      name: batch.name,
      fields: Object.keys(data),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "KIT_BATCH_UPDATE",
      "KitBatch",
      `${batch.name}${body.status !== undefined ? ` → ${batch.status}` : ""}`,
      actor.userId
    );
    return batch;
  }

  /** DELETE /api/kit-batches/:id (ADMIN) — removes units then the batch. */
  async remove(id: string, actor: Session): Promise<{ ok: true }> {
    const existing = await this.kitBatchRepository.findBatchById(id);
    if (!existing) {
      log.warn("kit_batch_delete_not_found", { batchId: id, actor: actor.userId });
      throw new ApiError("Batch not found", 404);
    }

    await this.kitBatchRepository.deleteUnits(id);
    await this.kitBatchRepository.delete(id);
    log.info("kit_batch_deleted", {
      batchId: id,
      name: existing.name,
      totalUnits: existing.totalUnits,
      actor: actor.userId,
    });

    await logActivity(actor.name, "KIT_BATCH_DELETE", "KitBatch", existing.name, actor.userId);
    return { ok: true };
  }
}
