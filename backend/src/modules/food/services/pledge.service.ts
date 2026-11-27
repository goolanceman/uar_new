/**
 * Pledge service — the food/grocery donation pledge lifecycle: public
 * submission with pickup details, the pickups-desk workflow (schedule →
 * collect → receive → reject/cancel) and the warehouse receipt that converts
 * a pledge into a traceable FoodBatch + master stock + InventoryTransaction
 * (the SAME single write path as a manual goods receipt — no duplicate
 * business logic). Transition rules come from @/lib/food-workflows (via
 * @/lib/food), code generation from @/lib/codes.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { assertTransition } from "@/lib/workflow";
import { FOOD_PLEDGE_TRANSITIONS } from "@/lib/food";
import { generateUniqueCode } from "@/lib/codes";
import { withTransaction } from "@/infrastructure/database/transactions/transaction.manager";
import type { FoodBody } from "../schemas/food.schema";
import type { FoodInventoryRepository } from "../repositories/food-inventory.repository.interface";
import type { FoodPledgeRepository } from "../repositories/food-pledge.repository.interface";

const log = logger.child("food");

const PLEDGE_PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
const PLEDGE_PIN_RE = /^[1-9][0-9]{5}$/;

/** Legacy `new Date(body.x)` over raw JSON values (epoch number | ISO string). */
const toDate = (v: unknown): Date => new Date(v as string | number);

export class PledgeService {
  constructor(
    private readonly pledgeRepository: FoodPledgeRepository,
    private readonly inventoryRepository: FoodInventoryRepository
  ) {}

  /** GET /api/food/pledges?mine=1 — signed-in donor's own pledges. */
  async listMine(session: Session): Promise<unknown> {
    return this.pledgeRepository.listPledgesByUser(session.userId);
  }

  /** GET /api/food/pledges — ADMIN pickups desk. */
  async listAdmin(sp: URLSearchParams): Promise<unknown> {
    return this.pledgeRepository.listPledges(sp.get("status"));
  }

  /** POST /api/food/pledges — PUBLIC pledge with pickup. The rate limiter
   *  and session probe run in the controller (request-bound lib calls)
   *  BEFORE this method, in legacy order. */
  async create(body: FoodBody, session: Session | null): Promise<unknown> {
    const donorName = String(body?.donorName ?? "").trim();
    const phoneRaw = String(body?.phone ?? "").trim();
    const items = String(body?.items ?? "").trim();
    const pickupAddress = String(body?.pickupAddress ?? "").trim();
    if (!donorName || !items || !pickupAddress)
      throw new ApiError("Name, what you're donating and the pickup address are required", 400);
    if (!phoneRaw || !PLEDGE_PHONE_RE.test(phoneRaw.replace(/[\s-]/g, "")))
      throw new ApiError("Please enter a valid Indian mobile number", 400);
    if (body?.pincode && !PLEDGE_PIN_RE.test(String(body.pincode).trim()))
      throw new ApiError("PIN code must look like 560001", 400);

    const phone = phoneRaw.replace(/[\s-]/g, "");

    // Double-submit guard (beyond the rate limiter): the same phone posting a
    // PENDING pledge with an identical items text in the last 60 seconds is a
    // double-tap/duplicate submit — reject it instead of creating a row.
    const duplicate = await this.pledgeRepository.findDuplicatePledge(phone, items, new Date(Date.now() - 60_000));
    if (duplicate) {
      log.warn("food_pledge_duplicate_blocked", { duplicateCode: duplicate.code, actor: session?.userId });
      throw new ApiError("You just submitted this pledge", 409);
    }

    const row = await this.pledgeRepository.createPledge({
      code: await this.nextPledgeCode(),
      userId: session?.userId ?? null,
      donorName,
      phone,
      email: body?.email ? String(body.email).trim() : null,
      orgName: body?.orgName ? String(body.orgName).trim() : null,
      items,
      pickupAddress,
      city: body?.city ? String(body.city).trim() : null,
      pincode: body?.pincode ? String(body.pincode).trim() : null,
      availability: body?.availability ? String(body.availability).trim() : null,
      storageNotes: body?.storageNotes ? String(body.storageNotes).trim() : null,
      createdByName: session?.name ?? donorName,
    });

    await this.pledgeRepository.createNotification({
      title: "New food donation pledge",
      message: `${donorName.split(" ")[0]} pledged groceries/supplies — reference ${row.code}. Schedule a pickup.`,
      type: "DISTRIBUTION",
      actionUrl: "/admin/food",
    });
    log.info("food_pledge_created", {
      pledgeId: row.id,
      code: row.code,
      actor: session?.userId,
    });
    await logActivity(donorName, "FOOD_PLEDGE_CREATE", "FoodDonationPledge", row.code, session?.userId);

    return { code: row.code, message: "Thank you! Our logistics team will call to schedule the pickup." };
  }

  /**
   * PATCH /api/food/pledges/:id — the pickups desk workflow.
   *  schedule  → { status: SCHEDULED, scheduledFor, assignedToName }
   *  collect   → { status: COLLECTED }            (picked up, in transit)
   *  receive   → { status: RECEIVED, itemId, batchNo, quantityReceived,
   *                expiryDate?, source? }          → creates the FoodBatch +
   *                master stock + InventoryTransaction (same write path as a
   *                manual goods receipt).
   *  reject/cancel → reason required.
   */
  async decide(id: string, body: FoodBody, session: Session): Promise<unknown> {
    const pledge = await this.pledgeRepository.findPledgeById(id);
    if (!pledge) {
      log.warn("food_pledge_not_found", { pledgeId: id, actor: session.userId });
      throw new ApiError("Donation pledge not found", 404);
    }

    const action = String(body?.action ?? "").toUpperCase();

    if (action === "SCHEDULE") {
      assertTransition(FOOD_PLEDGE_TRANSITIONS, pledge.status, "SCHEDULED", "food donation pledge");
      const scheduledFor = body?.scheduledFor ? toDate(body.scheduledFor) : null;
      if (!scheduledFor || isNaN(scheduledFor.getTime()))
        throw new ApiError("A pickup date/time is required", 400);
      await this.claimOrThrow(id, pledge.status, {
        status: "SCHEDULED",
        scheduledFor,
        assignedToName: body?.assignedToName ? String(body.assignedToName).trim() : session.name,
      }, "Donation pledge changed while this action was being processed");
      const updated = await this.pledgeRepository.findPledgeByIdOrThrow(id);
      log.info("food_pledge_scheduled", {
        pledgeId: id,
        code: pledge.code,
        scheduledFor: scheduledFor.toISOString(),
        actor: session.userId,
      });
      await logActivity(session.name, "FOOD_PLEDGE_SCHEDULE", "FoodDonationPledge", `${pledge.code} → pickup ${scheduledFor.toISOString()}`, session.userId);
      return updated;
    }

    if (action === "COLLECT") {
      assertTransition(FOOD_PLEDGE_TRANSITIONS, pledge.status, "COLLECTED", "food donation pledge");
      await this.claimOrThrow(id, pledge.status, { status: "COLLECTED" }, "Donation pledge changed while this action was being processed");
      const updated = await this.pledgeRepository.findPledgeByIdOrThrow(id);
      log.info("food_pledge_collected", { pledgeId: id, code: pledge.code, actor: session.userId });
      await logActivity(session.name, "FOOD_PLEDGE_COLLECT", "FoodDonationPledge", pledge.code, session.userId);
      return updated;
    }

    if (action === "RECEIVE") {
      assertTransition(FOOD_PLEDGE_TRANSITIONS, pledge.status, "RECEIVED", "food donation pledge");
      const itemId = String(body?.itemId ?? "");
      const batchNo = String(body?.batchNo ?? "").trim();
      const quantity = Number(body?.quantityReceived);
      if (!itemId || !batchNo)
        throw new ApiError("Choose the inventory item and enter a batch number", 400);
      if (!Number.isFinite(quantity) || quantity <= 0)
        throw new ApiError("Received quantity must be a positive number", 400);

      const item = await this.inventoryRepository.findItemById(itemId);
      if (!item) {
        log.warn("food_pledge_item_not_found", { pledgeId: id, itemId, actor: session.userId });
        throw new ApiError("Inventory item not found", 400);
      }
      const exists = await this.inventoryRepository.findBatchByItemAndBatchNo(itemId, batchNo);
      if (exists) {
        log.warn("food_pledge_batch_conflict", { pledgeId: id, itemId, batchNo, actor: session.userId });
        throw new ApiError(`Batch "${batchNo}" already exists for ${item.name}`, 409);
      }

      const source = String(body?.source ?? "DONATED").toUpperCase();
      const updated = await withTransaction(async (tx) => {
        const claimed = await this.pledgeRepository.claimPledgeStatus(id, pledge.status, {
          status: "RECEIVED",
          receivedBatchNo: batchNo,
          notes: body?.notes ? String(body.notes).trim() : pledge.notes,
        }, tx);
        if (claimed !== 1)
          throw new ApiError("Donation pledge changed while this receipt was being processed", 409);

        const batch = await this.inventoryRepository.createBatch({
          itemId,
          batchNo,
          source: ["DONATED", "RECOVERED", "CSR", "PARTNER"].includes(source) ? source : "DONATED",
          donorName: pledge.orgName ?? pledge.donorName,
          supplierName: null,
          quantityReceived: quantity,
          mfgDate: null,
          expiryDate: body?.expiryDate ? toDate(body.expiryDate) : null,
          storageNotes: pledge.storageNotes,
          tempRequirement: null,
          createdByName: session.name,
        }, tx);
        await this.inventoryRepository.incrementItemQuantity(itemId, quantity, tx);
        await this.inventoryRepository.createInventoryTransaction({
          itemId,
          type: "RECEIVED",
          quantity,
          batchNo,
          expiryDate: batch.expiryDate,
          source: batch.source,
          refType: "FOOD_PLEDGE",
          refId: pledge.id,
          notes: `Received from food donation pledge ${pledge.code} by ${session.name}`,
          handledByName: session.name,
        }, tx);
        return this.pledgeRepository.findPledgeByIdOrThrow(id, tx);
      });
      log.info("food_pledge_received", {
        pledgeId: id,
        code: pledge.code,
        itemId,
        batchNo,
        quantity,
        actor: session.userId,
      });
      await logActivity(session.name, "FOOD_PLEDGE_RECEIVE", "FoodDonationPledge", `${pledge.code} → batch ${batchNo} (${quantity})`, session.userId);
      return updated;
    }

    if (action === "REJECT" || action === "CANCEL") {
      const reason = String(body?.reason ?? "").trim();
      if (!reason) throw new ApiError("A reason is required", 400);
      const status = action === "REJECT" ? "REJECTED" : "CANCELLED";
      assertTransition(FOOD_PLEDGE_TRANSITIONS, pledge.status, status, "food donation pledge");
      await this.claimOrThrow(id, pledge.status, { status, rejectionReason: reason }, "Donation pledge changed while this action was being processed");
      const updated = await this.pledgeRepository.findPledgeByIdOrThrow(id);
      log.info(status === "REJECTED" ? "food_pledge_rejected" : "food_pledge_cancelled", {
        pledgeId: id,
        code: pledge.code,
        actor: session.userId,
      });
      await logActivity(session.name, `FOOD_PLEDGE_${status}`, "FoodDonationPledge", `${pledge.code}: ${reason.slice(0, 120)}`, session.userId);
      return updated;
    }

    throw new ApiError("action must be schedule, collect, receive, reject or cancel", 400);
  }

  /** Legacy transitionPledge — conditional claim, conflict when lost. */
  private async claimOrThrow(id: string, from: string, data: Parameters<FoodPledgeRepository["claimPledgeStatus"]>[2], conflictMessage: string): Promise<void> {
    const changed = await this.pledgeRepository.claimPledgeStatus(id, from, data);
    if (changed !== 1)
      throw new ApiError(conflictMessage, 409);
  }

  /** UAR-FDP-00001… — count-seeded, collision-safe (legacy nextPledgeCode). */
  private async nextPledgeCode(): Promise<string> {
    return this.pledgeRepository.countPledges().then((n) =>
      generateUniqueCode({
        prefix: "UAR-FDP",
        seed: n + 1,
        exists: (c) => this.pledgeRepository.findPledgeCodeOwner(c).then(Boolean),
      })
    );
  }
}
