/**
 * Kit scan route — /api/kit-scan
 * Converted 1:1 from src/app/api/kit-scan/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { kitBatchStatus } from "@/lib/kit";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const router = Router();

// POST /api/kit-scan (VOLUNTEER | ADMIN) — {code, location?}
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "VOLUNTEER", "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const code = String(body.code ?? "").trim().toUpperCase();
    if (!code) throw new ApiError("Kit code is required", 400);

    const unit = await db.kitUnit.findUnique({
      where: { code },
      include: { batch: true },
    });
    if (!unit) throw new ApiError("Kit code not found", 404);
    if (unit.status === "SCANNED")
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
    if (unit.status === "EXPIRED") throw new ApiError("unit expired", 409);

    const scannedAt = new Date();
    const updatedUnit = await db.kitUnit.update({
      where: { id: unit.id },
      data: {
        status: "SCANNED",
        scannedAt,
        scannedById: session.userId,
        scannedByName: session.name,
        location: body.location ? String(body.location).trim() : null,
      },
    });

    const scannedUnits = unit.batch.scannedUnits + 1;
    const batchStatus = kitBatchStatus(scannedUnits, unit.batch.totalUnits);
    const batch = await db.kitBatch.update({
      where: { id: unit.batchId },
      data: { scannedUnits, status: batchStatus },
    });

    await logActivity(
      session.name,
      "KIT_SCAN",
      "KitUnit",
      code,
      session.userId
    );

    return json(
      res,
      {
        unit: updatedUnit,
        batch: {
          name: batch.name,
          scannedUnits: batch.scannedUnits,
          totalUnits: batch.totalUnits,
        },
      },
      201
    );
  } catch (e) {
    return handleError(e, res);
  }
});
