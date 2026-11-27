/**
 * Programme service — the food programme catalog: public listing (safe
 * fields), admin listing, creation (always DRAFT), detail with event
 * rollups and lifecycle edits. Transition rules come from
 * @/modules/food/services/food.domain (FOOD_PROGRAMME_STATUSES/TRANSITIONS); code generation from
 * @/domains/codes.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { assertTransition } from "@/shared/workflow";
import { FOOD_PROGRAMME_STATUSES, FOOD_PROGRAMME_TRANSITIONS } from "@/modules/food/services/food.domain";
import { nextFoodProgrammeCode } from "@/domains/codes";
import type { FoodBody } from "../schemas/food.schema";
import type { FoodProgrammeRepository, ProgrammeUpdateData } from "../repositories/food-programme.repository.interface";

const log = logger.child("food");

const PROGRAMME_CATEGORIES = [
  "GROCERY_KIT", "COOKED_MEAL", "MONTHLY_RATION", "CHILD_NUTRITION", "SENIOR_SUPPORT",
  "EMERGENCY", "COMMUNITY_KITCHEN", "FESTIVAL", "RURAL", "SURPLUS_RECOVERY",
];
const PROGRAMME_FREQUENCIES = ["ONE_TIME", "WEEKLY", "MONTHLY", "QUARTERLY"];
const PROGRAMME_STATUSES: readonly string[] = FOOD_PROGRAMME_STATUSES;

/** Public-safe programme projection — internal budget/notes stay admin-only. */
function publicProgramme(p: {
  id: string; code: string; title: string; slug: string; description: string;
  category: string; targetGroup: string | null; geographicCoverage: string | null;
  frequency: string; assistanceCategories: string | null; eligibilityCriteria: string | null;
  status: string; coordinatorName: string | null; coordinatorPhone: string | null;
  endDate: Date | null;
}) {
  return {
    id: p.id, code: p.code, title: p.title, slug: p.slug, description: p.description,
    category: p.category, targetGroup: p.targetGroup, geographicCoverage: p.geographicCoverage,
    frequency: p.frequency, assistanceCategories: p.assistanceCategories,
    eligibilityCriteria: p.eligibilityCriteria, status: p.status,
    coordinatorName: p.coordinatorName, coordinatorPhone: p.coordinatorPhone,
    endDate: p.endDate,
  };
}

/** Legacy `new Date(body.x)` over raw JSON values (epoch number | ISO string). */
const toDate = (v: unknown): Date => new Date(v as string | number);

export class ProgrammeService {
  constructor(private readonly programmeRepository: FoodProgrammeRepository) {}

  /** GET /api/food/programmes?public=1 — public list (PUBLISHED/ACTIVE, visible, safe fields). */
  async listPublic(): Promise<unknown> {
    const rows = await this.programmeRepository.listPublicProgrammes();
    return rows.map(publicProgramme);
  }

  /** GET /api/food/programmes — admin list (all statuses). */
  async listAdmin(sp: URLSearchParams): Promise<unknown> {
    return this.programmeRepository.listProgrammes(sp.get("status"));
  }

  /** POST /api/food/programmes — ADMIN create. */
  async create(body: FoodBody, session: Session): Promise<unknown> {
    const title = String(body?.title ?? "").trim();
    const description = String(body?.description ?? "").trim();
    if (!title || !description) throw new ApiError("Title and description are required", 400);

    const category = String(body?.category ?? "GROCERY_KIT").toUpperCase();
    if (!PROGRAMME_CATEGORIES.includes(category)) throw new ApiError("Invalid programme category", 400);
    const frequency = String(body?.frequency ?? "ONE_TIME").toUpperCase();
    if (!PROGRAMME_FREQUENCIES.includes(frequency)) throw new ApiError("Invalid frequency", 400);
    const status = String(body?.status ?? "DRAFT").toUpperCase();
    if (!PROGRAMME_STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
    if (status !== "DRAFT") throw new ApiError("New food programmes must start in DRAFT", 400);

    const slugBase = String(body?.slug ?? title).trim()
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "programme";
    const slug = `${slugBase}-${Date.now().toString(36).slice(-4)}`;

    const campaignId = body?.campaignId ? String(body.campaignId) : null;
    if (campaignId && !(await this.programmeRepository.findCampaignById(campaignId))) {
      log.warn("food_programme_campaign_not_found", { campaignId, actor: session.userId });
      throw new ApiError("Linked campaign was not found", 400);
    }

    const row = await this.programmeRepository.createProgramme({
      code: await nextFoodProgrammeCode(),
      title, slug, description,
      category,
      targetGroup: body?.targetGroup ? String(body.targetGroup).trim() : null,
      geographicCoverage: body?.geographicCoverage ? String(body.geographicCoverage).trim() : null,
      startDate: body?.startDate ? toDate(body.startDate) : new Date(),
      endDate: body?.endDate ? toDate(body.endDate) : null,
      budget: Number(body?.budget) > 0 ? Number(body.budget) : null,
      fundraisingTarget: Number(body?.fundraisingTarget) > 0 ? Number(body.fundraisingTarget) : null,
      frequency,
      assistanceCategories: Array.isArray(body?.assistanceCategories) && body.assistanceCategories.length
        ? JSON.stringify((body.assistanceCategories as unknown[]).map(String)) : null,
      eligibilityCriteria: body?.eligibilityCriteria ? String(body.eligibilityCriteria).trim() : null,
      coordinatorName: body?.coordinatorName ? String(body.coordinatorName).trim() : null,
      coordinatorPhone: body?.coordinatorPhone ? String(body.coordinatorPhone).trim() : null,
      campaignId,
      publicVisible: body?.publicVisible !== false,
      status,
      createdByName: session.name,
    });

    log.info("food_programme_created", {
      programmeId: row.id,
      code: row.code,
      title: row.title,
      category: row.category,
      frequency: row.frequency,
      actor: session.userId,
    });
    await logActivity(session.name, "FOOD_PROGRAMME_CREATE", "FoodProgramme", `${row.code} — ${row.title}`, session.userId);
    return row;
  }

  /** GET /api/food/programmes/:id — ADMIN programme detail with event rollups. */
  async detail(id: string): Promise<unknown> {
    const row = await this.programmeRepository.findProgrammeDetail(id);
    if (!row) throw new ApiError("Food programme not found", 404);
    return row;
  }

  /** PATCH /api/food/programmes/:id — ADMIN edit / lifecycle. */
  async update(id: string, body: FoodBody, session: Session): Promise<unknown> {
    const row = await this.programmeRepository.findProgrammeById(id);
    if (!row) {
      log.warn("food_programme_not_found", { programmeId: id, actor: session.userId });
      throw new ApiError("Food programme not found", 404);
    }

    const data: ProgrammeUpdateData = {};
    if (body?.title !== undefined) data.title = String(body.title).trim();
    if (body?.description !== undefined) data.description = String(body.description).trim();
    if (body?.targetGroup !== undefined) data.targetGroup = body.targetGroup ? String(body.targetGroup).trim() : null;
    if (body?.geographicCoverage !== undefined) data.geographicCoverage = body.geographicCoverage ? String(body.geographicCoverage).trim() : null;
    if (body?.startDate !== undefined && body.startDate) data.startDate = toDate(body.startDate);
    if (body?.endDate !== undefined) data.endDate = body.endDate ? toDate(body.endDate) : null;
    if (body?.budget !== undefined) data.budget = Number(body.budget) > 0 ? Number(body.budget) : null;
    if (body?.fundraisingTarget !== undefined) data.fundraisingTarget = Number(body.fundraisingTarget) > 0 ? Number(body.fundraisingTarget) : null;
    if (body?.frequency !== undefined) data.frequency = String(body.frequency).toUpperCase();
    if (body?.eligibilityCriteria !== undefined) data.eligibilityCriteria = body.eligibilityCriteria ? String(body.eligibilityCriteria).trim() : null;
    if (body?.coordinatorName !== undefined) data.coordinatorName = body.coordinatorName ? String(body.coordinatorName).trim() : null;
    if (body?.coordinatorPhone !== undefined) data.coordinatorPhone = body.coordinatorPhone ? String(body.coordinatorPhone).trim() : null;
    if (body?.publicVisible !== undefined) data.publicVisible = Boolean(body.publicVisible);
    if (body?.campaignId !== undefined) data.campaignId = body.campaignId ? String(body.campaignId) : null;
    if (body?.status !== undefined) {
      const status = String(body.status).toUpperCase();
      if (!PROGRAMME_STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
      assertTransition(FOOD_PROGRAMME_TRANSITIONS, row.status, status, "food programme");
      data.status = status;
    }

    const updated = await this.programmeRepository.updateProgramme(id, data);
    log.info("food_programme_updated", {
      programmeId: id,
      code: updated.code,
      status: updated.status,
      fields: Object.keys(data),
      actor: session.userId,
    });
    await logActivity(session.name, "FOOD_PROGRAMME_UPDATE", "FoodProgramme", `${updated.code} → ${updated.status}`, session.userId);
    return updated;
  }
}
