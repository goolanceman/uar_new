import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/kit-scan (VOLUNTEER | ADMIN) — {code, location?}
export async function POST(req: Request) {
  try {
    const session = await requireRole("VOLUNTEER", "ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

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
    const batchStatus =
      scannedUnits >= unit.batch.totalUnits ? "DEPLETED" : "IN_PROGRESS";
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
    return handleError(e);
  }
}
