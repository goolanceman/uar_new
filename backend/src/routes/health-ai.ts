/**
 * Health AI routes — /api/health-ai, /api/health-ai/:id
 * Converted 1:1 from src/app/api/health-ai/* (Next.js route handlers) to Express.
 */
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireAuth,
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { assertTransition } from "@/lib/workflow";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const log = logger.child("health-ai");

export const router = Router();

// ─── AI governance (spec) ──────────────────────────────────────────────────────
// AI is an ASSISTANT here, never an actor: no auto-signing, no auto-dispensing,
// no auto-diagnoses. Every interaction is stored as a PENDING AIInteraction
// with minimised digests (length + truncated hash — never full notes/PHI) and
// needs human APPROVAL before the client applies anything through the normal
// record APIs. If the AI SDK is unavailable, consult-draft / timeline-summary /
// doc-extract fail 503 with NO interaction row written — AI is never a silent
// dependency — while camp-plan degrades to a deterministic offline plan built
// from the same aggregate stats (still recorded as PENDING for review).

export const CONSULT_DISCLAIMER = "AI draft — requires clinician review. Not a diagnosis.";

/** Minimised, non-sensitive digest: content length + truncated sha256. */
function digest(label: string, content: unknown): string {
  const s = String(content ?? "");
  const h = crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
  return `${label}: ${s.length} chars, sha256:${h}`;
}

/** Single LLM call following the z-ai-web-dev-sdk backend pattern. Throws on any failure. */
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
    (completion as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message
      ?.content ?? "";
  if (!text.trim()) throw new Error("empty AI response");
  return text.trim();
}

function pageParams(url: URL, defLimit = 50) {
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || defLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Resolve document text for extraction: prefer stored extractedText; else
 * fetch the asset and accept text/* / csv / json payloads only (Content-Type
 * based, since file-manager URLs carry no extension). Images/PDFs and failed
 * fetches return null → caller reports needsManualEntry.
 */
async function resolveDocumentText(
  doc: { extractedText: string | null; url: string },
  origin: string
): Promise<string | null> {
  if (doc.extractedText && doc.extractedText.trim()) return doc.extractedText;
  const abs = doc.url.startsWith("/") ? new URL(doc.url, origin).toString() : doc.url;
  try {
    // (Next.js `cache: "no-store"` dropped — Node's fetch does not cache.)
    const res = await fetch(abs);
    if (!res.ok) return null;
    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ctype.startsWith("text/") && !ctype.includes("csv") && !ctype.includes("json"))
      return null;
    const text = await res.text();
    return text.slice(0, 20000); // cap prompt size
  } catch {
    return null;
  }
}

const VALID_STATUSES = ["APPROVED", "REJECTED", "PENDING"];
// Review machine: decide once from PENDING · APPROVED/REJECTED are terminal
// (the reviewedByName stamp is the audit record — no re-decisions).
const TRANSITIONS: Record<string, string[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

// GET /api/health-ai — ADMIN lists recent AIInteraction rows for audit.
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    const action = url.searchParams.get("action");
    const status = url.searchParams.get("status");
    if (action) where.action = action;
    if (status) where.status = status;

    const [total, items] = await Promise.all([
      db.aIInteraction.count({ where }),
      db.aIInteraction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/health-ai — role-gated AI actions:
//   consult-draft (DOCTOR) · timeline-summary (DOCTOR|ADMIN)
//   camp-plan (ADMIN) · doc-extract (ADMIN|DOCTOR|NURSE)
router.post("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    // External-LLM cost control (gap A-7): 20 AI calls / hour per account.
    const rl = checkRateLimit(`health-ai:${session.userId}`, 20, 60 * 60 * 1000);
    if (!rl.allowed)
      return json(res, { error: "Too many AI requests — please try again in a while." }, 429);
    const body = req.body ?? {};
    const action = String(body?.action ?? "").trim();

    // ── consult-draft (DOCTOR only) ─────────────────────────────────────────
    if (action === "consult-draft") {
      if (session.role !== "DOCTOR")
        throw new ApiError("consult-draft is available to doctors only", 403);
      const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
      if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);

      const beneficiary = await db.beneficiary.findUnique({
        where: { id: beneficiaryId },
        select: { code: true, name: true, age: true, gender: true },
      });
      if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

      const encounterId = optText(body?.encounterId);
      if (encounterId) {
        const enc = await db.encounter.findUnique({ where: { id: encounterId }, select: { id: true } });
        if (!enc) throw new ApiError("Encounter not found", 404);
      }

      const chiefComplaint = optText(body?.chiefComplaint) ?? "(not provided)";
      const observations = optText(body?.observations) ?? "(not provided)";
      const vitalSummary = optText(body?.vitalSummary) ?? "(not provided)";

      let draft: string;
      try {
        draft = await askAI(
          "You are a clinical documentation assistant for United Angel Reach medical camps. Draft a structured consultation-note OUTLINE for the treating doctor to review and edit. Use ONLY the information provided — never invent findings, values or diagnoses. Sections, exactly: SUBJECTIVE / OBJECTIVE / ASSESSMENT SUGGESTIONS (framed as possibilities, not conclusions) / ADVICE. End with the line: 'AI draft — requires clinician review. Not a diagnosis.' Plain text, concise.",
          `Patient: ${beneficiary.code}, age ${beneficiary.age ?? "unknown"}, ${beneficiary.gender ?? "gender unknown"}.\nChief complaint: ${chiefComplaint}\nObservations: ${observations}\nVitals summary: ${vitalSummary}`
        );
      } catch (e) {
        log.error("consult_draft_failed", {
          error: e instanceof Error ? e : String(e),
          beneficiaryId,
        });
        throw new ApiError("AI service is unavailable — nothing was recorded. Please retry later.", 503);
      }

      const interaction = await db.aIInteraction.create({
        data: {
          action: "CONSULT_DRAFT",
          entityType: encounterId ? "ENCOUNTER" : "BENEFICIARY",
          entityId: encounterId ?? beneficiaryId,
          promptDigest: digest("consult inputs", `${chiefComplaint}\n${observations}\n${vitalSummary}`),
          outputDigest: digest("draft", draft),
          status: "PENDING",
          userId: session.userId,
        },
      });

      if (encounterId)
        await db.encounter.update({ where: { id: encounterId }, data: { aiDraftUsed: true } });

      await logActivity(session.name, "AI_CONSULT_DRAFT", "AI_INTERACTION", `Consult draft for ${beneficiary.code}`, session.userId);

      return json(res, {
        id: interaction.id,
        action: "CONSULT_DRAFT",
        draft,
        disclaimer: CONSULT_DISCLAIMER,
        status: "PENDING",
      });
    }

    // ── timeline-summary (DOCTOR | ADMIN) — operational, non-clinical ───────
    if (action === "timeline-summary") {
      if (session.role !== "DOCTOR" && session.role !== "ADMIN")
        throw new ApiError("timeline-summary is available to doctors and admins only", 403);
      const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
      if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
      const beneficiary = await db.beneficiary.findUnique({
        where: { id: beneficiaryId },
        select: { id: true, code: true },
      });
      if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

      const [encounters, vitals, screenings, rx, labsPending, referralsOpen, followUpsPending] =
        await Promise.all([
          db.encounter.count({ where: { beneficiaryId } }),
          db.vitalObservation.count({ where: { beneficiaryId } }),
          db.screeningRecord.count({ where: { beneficiaryId } }),
          db.prescription.count({ where: { beneficiaryId } }),
          db.diagnosticOrder.count({ where: { beneficiaryId, status: { notIn: ["DOCTOR_REVIEWED", "CANCELLED"] } } }),
          db.medicalReferral.count({ where: { beneficiaryId, status: { notIn: ["COMPLETED", "CANCELLED", "LOST_TO_FOLLOWUP"] } } }),
          db.followUp.count({ where: { beneficiaryId, status: "PENDING" } }),
        ]);

      let summary: string;
      try {
        summary = await askAI(
          "You write SHORT operational summaries for camp coordinators. STRICTLY NON-CLINICAL: never interpret medical data, never suggest diagnoses or treatments. Summarise only the activity statistics given (visit counts, pending items) in 3-5 sentences and end with one practical follow-up suggestion (e.g. book pending referrals).",
          `Beneficiary ${beneficiary.code} activity: encounters=${encounters}, vitals records=${vitals}, screenings=${screenings}, prescriptions=${rx}, lab orders awaiting result/review=${labsPending}, open referrals=${referralsOpen}, pending follow-ups=${followUpsPending}.`
        );
      } catch (e) {
        log.error("timeline_summary_failed", {
          error: e instanceof Error ? e : String(e),
          beneficiaryId,
        });
        throw new ApiError("AI service is unavailable — nothing was recorded. Please retry later.", 503);
      }

      const interaction = await db.aIInteraction.create({
        data: {
          action: "TIMELINE_SUMMARY",
          entityType: "BENEFICIARY",
          entityId: beneficiaryId,
          promptDigest: digest("timeline stats", `enc=${encounters}, vit=${vitals}, scr=${screenings}, rx=${rx}, labs=${labsPending}, refs=${referralsOpen}, fups=${followUpsPending}`),
          outputDigest: digest("summary", summary),
          status: "PENDING",
          userId: session.userId,
        },
      });

      await logActivity(session.name, "AI_TIMELINE_SUMMARY", "AI_INTERACTION", `Operational summary for ${beneficiary.code}`, session.userId);

      return json(res, {
        id: interaction.id,
        action: "TIMELINE_SUMMARY",
        summary,
        stats: { encounters, vitals, screenings, prescriptions: rx, labsPending, referralsOpen, followUpsPending },
        disclaimer: "Operational summary only — not medical advice.",
        status: "PENDING",
      });
    }

    // ── camp-plan (ADMIN) ────────────────────────────────────────────────────
    if (action === "camp-plan") {
      if (session.role !== "ADMIN")
        throw new ApiError("camp-plan is available to admins only", 403);
      const city = optText(body?.city);

      const campWhere: Prisma.MedicalCampWhereInput = city
        ? { city: { contains: city } }
        : {};
      const attendanceWhere: Prisma.CampAttendanceWhereInput = city
        ? { camp: { city: { contains: city } } }
        : {};

      const [totalCamps, byStatus, attendanceTotal, noShows, topCities] = await Promise.all([
        db.medicalCamp.count({ where: campWhere }),
        db.medicalCamp.groupBy({
          by: ["status"],
          _count: true,
          where: campWhere,
        }),
        db.campAttendance.count({ where: attendanceWhere }),
        db.campAttendance.count({
          where: { status: "NO_SHOW", ...attendanceWhere },
        }),
        db.medicalCamp.groupBy({
          by: ["city"],
          _count: true,
          where: city ? campWhere : { city: { not: null } },
          orderBy: { _count: { city: "desc" } },
          take: 5,
        }),
      ]);

      const avgAttendance = totalCamps > 0 ? Math.round((attendanceTotal / totalCamps) * 10) / 10 : 0;
      const noShowRate = attendanceTotal > 0 ? Math.round((noShows / attendanceTotal) * 1000) / 10 : 0;
      const assumptions = [
        `${totalCamps} camps on record${city ? ` in/near ${city}` : ""} (by status: ${byStatus.map((s) => `${s.status}=${s._count}`).join(", ") || "none"})`,
        `average attendance ≈ ${avgAttendance} checked-in beneficiaries per camp`,
        `no-show rate ≈ ${noShowRate}% of all check-ins`,
        `top cities: ${topCities.map((c) => `${c.city ?? "unknown"} (${c._count})`).join(", ") || "none on record"}`,
      ];

      let plan: string;
      try {
        plan = await askAI(
          "You are a health-camp planning advisor for United Angel Reach (a charitable trust running free medical camps across India). Using ONLY the statistics provided, propose 4-6 concrete planning suggestions (frequency, staffing, inventory buffer, city targeting, follow-up capacity). Explicitly list the ASSUMPTIONS you relied on and flag where real data is too thin to conclude. Plain text, concise.",
          assumptions.map((a) => `- ${a}`).join("\n")
        );
      } catch (e) {
        // Degrade like /api/assistant/chat does: a deterministic offline plan
        // built from the SAME aggregate stats — the request still succeeds
        // and the interaction is still recorded for review (status PENDING).
        log.warn("camp_plan_failed_offline_fallback", {
          error: e instanceof Error ? e : String(e),
          city,
        });
        plan = [
          "Offline plan — AI service unavailable. Generated deterministically from the aggregate camp stats:",
          `1. Frequency: build on the current cadence (${totalCamps} camp(s) on record${city ? ` in/near ${city}` : ""}); schedule the next editions in the cities with the most camps so far (${topCities.map((c) => c.city ?? "unknown").join(", ") || "none on record"}).`,
          `2. Staffing: budget doctors/volunteers for the observed average of ≈ ${avgAttendance} checked-in beneficiaries per camp.`,
          `3. Inventory buffer: stock medicines/consumables for ≈ ${Math.ceil(avgAttendance * 1.1)} beneficiaries per camp (10% headroom over the average).`,
          `4. No-shows: with a ≈ ${noShowRate}% no-show rate, send reminders and overbook check-in slots accordingly.`,
          `5. Follow-up capacity: reserve review capacity for the camps currently on record (by status: ${byStatus.map((s) => `${s.status}=${s._count}`).join(", ") || "none"}).`,
          "These figures come from thin aggregate data — validate each line against ground truth before acting.",
        ].join("\n");
      }

      const interaction = await db.aIInteraction.create({
        data: {
          action: "CAMP_PLAN",
          entityType: "MEDICAL_CAMP",
          entityId: city ?? null,
          promptDigest: digest("camp stats", assumptions.join("; ")),
          outputDigest: digest("plan", plan),
          status: "PENDING",
          userId: session.userId,
        },
      });

      await logActivity(session.name, "AI_CAMP_PLAN", "AI_INTERACTION", `Camp plan${city ? ` for ${city}` : ""}`, session.userId);

      return json(res, {
        id: interaction.id,
        action: "CAMP_PLAN",
        plan,
        assumptions,
        disclaimer: "Planning suggestions based on aggregate stats — validate against ground truth before acting.",
        status: "PENDING",
      });
    }

    // ── doc-extract (ADMIN | DOCTOR | NURSE) ────────────────────────────────
    if (action === "doc-extract") {
      const allowed = ["ADMIN", "DOCTOR", "NURSE"];
      if (!allowed.includes(session.role))
        throw new ApiError("doc-extract is available to staff only", 403);
      const documentId = String(body?.documentId ?? "").trim();
      if (!documentId) throw new ApiError("documentId is required", 400);

      const doc = await db.medicalDocument.findUnique({ where: { id: documentId } });
      if (!doc) throw new ApiError("Document not found", 404);

      // Origin for resolving relative /api/files/:id/file URLs comes from the
      // incoming request (Express req.url is path-only, unlike NextRequest).
      const origin = new URL(req.url, `${req.protocol}://${req.headers.host ?? "localhost"}`).origin;
      const text = await resolveDocumentText(doc, origin);
      if (text === null)
        return json(res, {
          action: "DOC_EXTRACT",
          documentId,
          needsManualEntry: true,
          reason: "Image/PDF documents cannot be text-extracted in-browser — upload extracted text or enter manually.",
        });

      let raw: string;
      try {
        raw = await askAI(
          "You extract structured data from medical documents for a charitable trust's records. From the text below, return ONLY a JSON object (no prose, no markdown fences) with this exact shape: {\"provider\": string|null, \"date\": string|null (ISO when inferable), \"medications\": [{\"name\": string, \"dosage\": string|null}], \"tests\": [string], \"confidence\": number (0-1, your overall extraction confidence)}. Use null/[] when absent. Never invent values.",
          text
        );
      } catch (e) {
        log.error("doc_extract_failed", {
          error: e instanceof Error ? e : String(e),
          documentId,
        });
        throw new ApiError("AI service is unavailable — nothing was recorded. Please retry later.", 503);
      }

      // Lenient JSON extraction — models occasionally wrap JSON in prose/fences.
      let suggestions: unknown = null;
      let confidence: number | null = null;
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const parsed = JSON.parse(m[0]) as { confidence?: number };
          suggestions = parsed;
          confidence = typeof parsed.confidence === "number" ? parsed.confidence : null;
        } catch {
          suggestions = null;
        }
      }
      if (suggestions === null)
        return json(res, {
          action: "DOC_EXTRACT",
          documentId,
          needsManualEntry: true,
          reason: "The AI response could not be parsed as structured suggestions.",
          rawExcerpt: raw.slice(0, 400),
        });

      const interaction = await db.aIInteraction.create({
        data: {
          action: "DOC_EXTRACT",
          entityType: "MEDICAL_DOCUMENT",
          entityId: doc.id,
          promptDigest: digest("document text", text),
          outputDigest: digest("suggestions", JSON.stringify(suggestions)),
          confidence,
          status: "PENDING",
          userId: session.userId,
        },
      });

      await logActivity(session.name, "AI_DOC_EXTRACT", "AI_INTERACTION", `Extraction suggestions for "${doc.name}"`, session.userId);

      return json(res, {
        id: interaction.id,
        action: "DOC_EXTRACT",
        documentId: doc.id,
        suggestions,
        confidence,
        disclaimer: "Suggestions only — review, then apply via the normal record APIs. Nothing is written automatically.",
        status: "PENDING",
      });
    }

    throw new ApiError(
      "action must be one of: consult-draft, timeline-summary, camp-plan, doc-extract",
      400
    );
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/health-ai/:id — human review of an AI interaction (audit trail).
// ADMIN | DOCTOR sets status APPROVED | REJECTED; reviewedByName is stamped
// from the session automatically — clients cannot forge the reviewer.
// The AI output itself is NEVER applied by this endpoint: the client applies
// accepted data through the normal record APIs afterwards.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR");
    const { id } = req.params;
    const body = req.body ?? {};

    const status = String(body?.status ?? "").trim().toUpperCase();
    if (!VALID_STATUSES.includes(status))
      throw new ApiError(`status must be one of: ${VALID_STATUSES.join(", ")}`, 400);

    const existing = await db.aIInteraction.findUnique({ where: { id } });
    if (!existing) throw new ApiError("AI interaction not found", 404);

    assertTransition(TRANSITIONS, existing.status, status, "AI interaction");

    const interaction = await db.aIInteraction.update({
      where: { id },
      data: { status, reviewedByName: session.name },
    });

    await logActivity(
      session.name,
      "AI_REVIEW",
      "AI_INTERACTION",
      `${existing.action} ${existing.id} → ${status}`,
      session.userId
    );

    return json(res, interaction);
  } catch (e) {
    return handleError(e, res);
  }
});
