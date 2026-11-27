/**
 * Campaigns routes — thin endpoint definitions; all logic lives in
 * src/modules/campaigns (routes → controllers → services → repositories).
 * The historical export path (`@/routes/campaigns`) is preserved: tests and
 * the app entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { listCampaignsQuerySchema } from "@/modules/campaigns/schemas/campaign.schema";
import { campaignController } from "@/modules/campaigns";

export const router = Router();

// GET /api/campaigns — public list (validateSession personalizes inline in
// the controller — optional session, not a gate).
router.get("/", validate({ query: listCampaignsQuerySchema }), campaignController.list);

// POST /api/campaigns — admin creates a campaign
router.post("/", authorize("ADMIN"), campaignController.create);

// GET /api/campaigns/:id — by id, falling back to slug (public)
router.get("/:id", campaignController.detail);

// PATCH /api/campaigns/:id/urgency — ADMIN/MODERATOR manages the urgent appeal
// (declared before the conflicting "/:id" pattern).
router.patch("/:id/urgency", authorize("ADMIN", "MODERATOR"), campaignController.updateUrgency);

// PATCH /api/campaigns/:id — admin edits a campaign (full whitelist)
router.patch("/:id", authorize("ADMIN"), campaignController.update);

// DELETE /api/campaigns/:id — admin removes a campaign (donations kept, unlinked)
router.delete("/:id", authorize("ADMIN"), campaignController.remove);
