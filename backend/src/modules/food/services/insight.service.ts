/**
 * Insight service — AI Food Security insights, ADMIN-only, advisory-only.
 * Follows the health-ai governance contract: every run writes a PENDING
 * AIInteraction with minimised digests (length only — never raw content);
 * the assistant never approves beneficiaries, moves stock, spends money or
 * publishes anything. The exact legacy prompts, data payloads and log event
 * names are preserved. AI-provider failures are signalled with a typed
 * marker so the controller renders the legacy 503 without extra logs.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import { type Session } from "@/infrastructure/auth/session";
import { availableOf, foodWindowDays } from "@/modules/food/services/food.domain";
import type { FoodBody } from "../schemas/food.schema";
import type { FoodInsightRepository } from "../repositories/food-insight.repository.interface";

const log = logger.child("food");

function digest(label: string, content: unknown): string {
  return `${label}: ${String(content ?? "").length} chars`;
}

async function askAI(system: string, user: string): Promise<string> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text =
    (completion as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("empty AI response");
  return text.trim();
}

const GUARD =
  "You are the UAR Food Security assistant. You advise staff; you NEVER approve beneficiaries, change inventory, move money or publish content. Use only the supplied data, state assumptions, and be concise. Do not reveal any beneficiary personal details.";

export class InsightService {
  constructor(private readonly insightRepository: FoodInsightRepository) {}

  /** POST /api/food/insights { mode, eventId?, question? } — plan/forecast/analytics/waste. */
  async generate(body: FoodBody, session: Session): Promise<unknown> {
    const mode = String(body?.mode ?? "analytics");

    if (mode === "plan") {
      const eventId = String(body?.eventId ?? "");
      const event = await this.insightRepository.findEventContext(eventId);
      if (!event) throw new ApiError("Food event not found", 404);
      const inventory = await this.insightRepository.listFoodKitInventory();
      const activeRegs = event.registrations.filter((r) => !["CANCELLED", "REJECTED"].includes(r.status));
      const data = {
        event: { code: event.code, title: event.title, type: event.eventType, plannedUnits: event.plannedUnits, status: event.status },
        programme: event.programme,
        template: event.packageTemplate?.name ?? null,
        templateItems: event.packageTemplate?.items ?? null,
        registrations: { active: activeRegs.length, allocatedUnits: activeRegs.reduce((s, r) => s + r.unitsAllocated, 0) },
        stock: inventory.map((i) => ({ name: i.name, unit: i.unit, quantity: i.quantity, minStock: i.minStock, expiryDate: i.expiryDate })),
        expenses: event.expenses,
        budget: event.budget,
      };
      const output = await askAI(
        GUARD,
        `Plan this food distribution event. Data:\n${JSON.stringify(data)}\n\nSuggest: packages to prepare, ingredient/stock requirements vs availability (flag shortfalls), volunteer numbers by role, estimated cost, and risks. State every assumption.`
      );
      await this.storeInteraction("FOOD_PLAN", digest("event", event.code), output, eventId);
      log.info("food_insight_generated", { mode: "plan", eventId, actor: session.userId });
      return { output };
    }

    if (mode === "forecast") {
      const [byMonth, byCity, topItems, pendingApps] = await Promise.all([
        this.insightRepository.groupRegistrationsByStatus(),
        this.insightRepository.groupEventsByCity(),
        this.insightRepository.listStockSummary(),
        this.insightRepository.countPendingApplications(),
      ]);
      const recentEvents = await this.insightRepository.listRecentEvents();
      const data = { byMonth, byCity, stock: topItems, pendingApps, recentEvents };
      const output = await askAI(
        GUARD,
        `Forecast food demand for the next 4-8 weeks. Data:\n${JSON.stringify(data)}\n\nGive: expected demand ranges by area, stock items likely to run short, and seasonality notes. State confidence and assumptions. This is advisory only.`
      );
      await this.storeInteraction("FOOD_FORECAST", digest("aggregates", data), output);
      log.info("food_insight_generated", { mode: "forecast", actor: session.userId });
      return { output };
    }

    if (mode === "analytics") {
      const question = String(body?.question ?? "").trim();
      if (!question || question.length < 5) throw new ApiError("Ask a question first", 400);

      const [families, individuals, kits, meals, noShows, eventsByStatus, topDonors, expensesByHead, appsByCity] =
        await Promise.all([
          this.insightRepository.listDistributedHouseholdIds(),
          this.insightRepository.listDistributedBeneficiaryIds(),
          this.insightRepository.aggregateDeliveredUnits(),
          this.insightRepository.listMealEventIds(),
          this.insightRepository.countNoShows(),
          this.insightRepository.groupEventsByStatus(),
          this.insightRepository.listTopFoodDonors(),
          this.insightRepository.groupExpensesByHead(),
          this.insightRepository.listApplicationsCityStatus(),
        ]);
      const mealEventIds = new Set(meals.map((e) => e.id));
      const mealSums = await this.insightRepository.aggregateMealDelivered(Array.from(mealEventIds));
      const data = {
        familiesSupported: families.length,
        individualsReached: individuals.length,
        kitsDistributed: kits._sum.unitsDelivered ?? 0,
        mealsServed: mealSums._sum.unitsDelivered ?? 0,
        noShows,
        eventsByStatus,
        topFoodDonors: topDonors.map((d) => ({ name: d.isAnonymous ? "Anonymous" : d.donorName, amount: d.amount })),
        expensesByHead,
        applicationsByCity: appsByCity,
      };
      const output = await askAI(
        GUARD,
        `Answer this question using ONLY the data below. Include the reporting period (all time) and define metrics you use.\n\nQuestion: ${question}\n\nData:\n${JSON.stringify(data)}`
      );
      await this.storeInteraction("FOOD_ANALYTICS", digest("question", question), output);
      log.info("food_insight_generated", { mode: "analytics", actor: session.userId });
      return { output };
    }

    if (mode === "waste") {
      const batches = await this.insightRepository.listActiveBatchesWithItem();
      const riskWindowDays = await foodWindowDays("food.aiRiskWindowDays");
      const atRisk = batches
        .filter((b) => availableOf(b) > 0 && b.expiryDate && b.expiryDate.getTime() < Date.now() + riskWindowDays * 86400000)
        .map((b) => ({ item: b.item.name, batchNo: b.batchNo, free: availableOf(b), unit: b.item.unit, expiryDate: b.expiryDate, qualityStatus: b.qualityStatus }));
      const cancelled = await this.insightRepository.listInterruptedEvents();
      const output = await askAI(
        GUARD,
        `Suggest how to prevent food waste. At-risk stock (expiring within ${riskWindowDays} days, free quantity):\n${JSON.stringify(atRisk)}\n\nCancelled/postponed events:\n${JSON.stringify(cancelled)}\n\nRecommend which upcoming distributions or programmes each batch could be redirected to, in priority order. NEVER suggest distributing expired, quarantined or rejected stock — exclude anything not PASSED and unexpired.`
      );
      await this.storeInteraction("FOOD_WASTE", digest("atRisk", atRisk), output);
      log.info("food_insight_generated", { mode: "waste", actor: session.userId });
      return { output };
    }

    throw new ApiError("mode must be plan, forecast, analytics or waste", 400);
  }

  /** PENDING AIInteraction audit row (human review required before use). */
  private async storeInteraction(action: string, promptDigest: string, output: string, entityId?: string) {
    await this.insightRepository.createAIInteraction({
      action,
      entityType: "FoodEvent",
      entityId: entityId ?? null,
      promptDigest,
      outputDigest: digest("output", output),
      status: "PENDING",
    });
  }
}
