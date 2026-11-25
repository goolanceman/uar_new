/**
 * Animal pledges admin route — /api/animal-pledges/:id
 * Converted 1:1 from src/app/api/animal-pledges/[id]/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { ANIMAL_PLEDGE_STATUSES } from "@/lib/animals";

export const router = Router();

const STATUSES = ANIMAL_PLEDGE_STATUSES;
const KINDS = ["FOOD", "MEDICAL", "VACCINATION", "SHELTER"];
const FREQUENCIES = ["ONE_TIME", "MONTHLY"];

// PATCH /api/animal-pledges/:id (ADMIN)
// Accepts {status} alone (original contract) or any of donorName, amount,
// kind, frequency, shelterFund, animalId for full admin edits.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const pledge = await db.animalPledge.findUnique({ where: { id } });
    if (!pledge) throw new ApiError("Pledge not found", 404);

    const data: Record<string, unknown> = {};
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status))
        throw new ApiError("status must be ACTIVE, COMPLETED or CANCELLED", 400);
      data.status = status;
    }
    if (body.donorName !== undefined) {
      const donorName = String(body.donorName).trim();
      if (!donorName) throw new ApiError("donorName cannot be empty", 400);
      data.donorName = donorName;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new ApiError("amount must be greater than 0", 400);
      data.amount = amount;
    }
    if (body.kind !== undefined) {
      const kind = String(body.kind).trim().toUpperCase();
      if (!KINDS.includes(kind))
        throw new ApiError("kind must be FOOD, MEDICAL, VACCINATION or SHELTER", 400);
      data.kind = kind;
    }
    if (body.frequency !== undefined) {
      const frequency = String(body.frequency).trim().toUpperCase();
      if (!FREQUENCIES.includes(frequency))
        throw new ApiError("frequency must be ONE_TIME or MONTHLY", 400);
      data.frequency = frequency;
    }
    if (body.shelterFund !== undefined)
      data.shelterFund = body.shelterFund ? String(body.shelterFund).trim() : null;
    if (body.animalId !== undefined) {
      if (body.animalId) {
        const animal = await db.animal.findUnique({
          where: { id: String(body.animalId) },
        });
        if (!animal) throw new ApiError("Animal not found", 404);
        data.animalId = String(body.animalId);
      } else {
        data.animalId = null;
      }
    }

    const updated = await db.animalPledge.update({
      where: { id },
      data: data as never,
    });
    await logActivity(
      session.name,
      "ANIMAL_PLEDGE_UPDATE",
      "AnimalPledge",
      `${pledge.donorName} · ${pledge.kind} ₹${pledge.amount}${data.status ? ` → ${String(data.status)}` : ""}`,
      session.userId
    );
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/animal-pledges/:id (ADMIN)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const pledge = await db.animalPledge.findUnique({ where: { id } });
    if (!pledge) throw new ApiError("Pledge not found", 404);

    await db.animalPledge.delete({ where: { id } });
    await logActivity(
      session.name,
      "ANIMAL_PLEDGE_DELETE",
      "AnimalPledge",
      `${pledge.donorName} · ${pledge.kind} ₹${pledge.amount}`,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
