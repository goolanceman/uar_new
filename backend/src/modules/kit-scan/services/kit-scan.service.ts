/**
 * Kit scan service — the READY → SCANNED unit machine with duplicate/expired
 * gates, batch roll-up via kitBatchStatus, and the exact legacy log events in
 * the legacy order (unit update → batch update → info → conditional debug →
 * activity log). Depends on the repository contract, never touches HTTP.
 */
import { logger } from "@/lib/logger";
import { kitBatchStatus } from "@/lib/kit";
import { ApiError, logActivity, type Session } from "@/lib/session";
import type { KitScanRepository, KitBatchRow, KitUnitRow } from "../repositories/kit-scan.repository.interface";

const log = logger.child("kit-scan");

export interface KitScanResult {
  unit: KitUnitRow;
  batch: {
    name: string;
    scannedUnits: number;
    totalUnits: number;
  };
}

export class KitScanService {
  constructor(private readonly kitScanRepository: KitScanRepository) {}

  /** POST /api/kit-scan (VOLUNTEER | ADMIN) — {code, location?} */
  async scan(session: Session, rawBody: Record<string, unknown> | null | undefined): Promise<KitScanResult> {
    const body = (rawBody ?? {}) as Record<string, unknown>;

    const code = String(body.code ?? "").trim().toUpperCase();
    if (!code) throw new ApiError("Kit code is required", 400);

    const unit = await this.kitScanRepository.findUnitByCode(code);
    if (!unit) {
      log.warn("kit_scan_unit_not_found", { code, actor: session.userId });
      throw new ApiError("Kit code not found", 404);
    }
    if (unit.status === "SCANNED") {
      log.warn("kit_scan_duplicate", {
        kitUnitId: unit.id,
        code,
        batchId: unit.batchId,
        scannedAt: unit.scannedAt,
        actor: session.userId,
      });
      throw new ApiError(
        `already scanned at ${
          unit.scannedAt
            ? new Date(unit.scannedAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "an earlier time"
        }`,
        409
      );
    }
    if (unit.status === "EXPIRED") {
      log.warn("kit_scan_expired", {
        kitUnitId: unit.id,
        code,
        batchId: unit.batchId,
        actor: session.userId,
      });
      throw new ApiError("unit expired", 409);
    }

    const scannedAt = new Date();
    const updatedUnit = await this.kitScanRepository.markUnitScanned(unit.id, {
      status: "SCANNED",
      scannedAt,
      scannedById: session.userId,
      scannedByName: session.name,
      location: body.location ? String(body.location).trim() : null,
    });

    const scannedUnits = unit.batch.scannedUnits + 1;
    const batchStatus = kitBatchStatus(scannedUnits, unit.batch.totalUnits);
    const batch: KitBatchRow = await this.kitScanRepository.updateBatch(unit.batchId, {
      scannedUnits,
      status: batchStatus,
    });

    log.info("kit_scan_recorded", {
      kitUnitId: unit.id,
      code,
      batchId: unit.batchId,
      scannedUnits: batch.scannedUnits,
      totalUnits: batch.totalUnits,
      batchStatus: batch.status,
      actor: session.userId,
    });
    if (batch.status !== unit.batch.status) {
      log.debug("kit_scan_batch_status_changed", {
        batchId: unit.batchId,
        from: unit.batch.status,
        to: batch.status,
        scannedUnits: batch.scannedUnits,
        totalUnits: batch.totalUnits,
      });
    }
    await logActivity(session.name, "KIT_SCAN", "KitUnit", code, session.userId);

    return {
      unit: updatedUnit,
      batch: {
        name: batch.name,
        scannedUnits: batch.scannedUnits,
        totalUnits: batch.totalUnits,
      },
    };
  }
}
