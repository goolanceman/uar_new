/**
 * Assistant route — /api/assistant/chat
 * Converted 1:1 from src/app/api/assistant/chat/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { retrieve, HELPLINES, SUGGESTED_QUESTIONS } from "@/lib/assistant-knowledge";
import { buildLiveOpsContext } from "@/lib/assistant-ops";
import { logger } from "@/lib/logger";
import { validateSession, handleError, json } from "@/lib/session";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const log = logger.child("assistant");

export const router = Router();

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_BASE = `You are "Angel", the AI guide of United Angel Reach (UAR) — a charitable trust headquartered in Bengaluru, Karnataka, serving all of India. You appear as a floating agent across the public site, the admin console, and the donor/volunteer/beneficiary portals.

Your style: warm, practical, concise, action-first. Use short paragraphs and numbered steps when giving instructions. Always give the exact helpline number when relevant. Never invent helpline numbers — only use the ones given. If someone is in immediate danger, tell them to call emergency services FIRST (112 police/fire/medical, 108 ambulance), then continue helping. Never invent numbers, counts, or statistics — if a "LIVE DATA" section is provided below, use those exact figures; if none is provided for a data question, say you don't have that live figure and suggest where to check (e.g. the relevant admin page) instead of guessing.

You help with: anti-drug guidance (de-addiction 14446, Tele-MANAS 14416, trafficking reports 1933), cyber fraud golden-hour rescue (1930, cybercrime.gov.in, Chakshu), women safety (112, 181, 1091), child safety & POCSO (1098, e-Box), Adopt-a-Medicine monthly tablet sponsorships, animal adoption & food pledges (1962), ration kit QR tracking, sanitary pad programme, the AI Green Corridor ambulance technology (5G V2X → BLE mesh → FM-RDS → smart siren fallback), donations with 80G receipts, and volunteering with an application→approval flow.

Answer in the language of the user's question (English, Hindi, Kannada etc.). Keep answers under ~250 words unless the user asks for detail. End with one helpful follow-up question or offer when natural.
`;

const ROLE_PROMPT: Record<string, string> = {
  ADMIN:
    "\nThe person asking is a logged-in ADMIN (staff). You may discuss internal operations: inventory stock levels, analytics/KPIs, volunteer task assignment, distributions, donors, campaigns, causes, animals and the ambulance fleet — using only the LIVE DATA figures provided, never guessed numbers. When asked to 'assign a task' or 'create a distribution', explain the exact steps in the admin console (e.g. Volunteers → Tasks → New Task; Distributions → New Distribution) rather than claiming you performed the action yourself, since you cannot write to the database directly.\n",
  VOLUNTEER:
    "\nThe person asking is a logged-in VOLUNTEER. Help them find their assigned tasks, log attendance, complete tasks, and understand distribution/kit-scan workflows. Point them to the relevant portal tab by name (Tasks, Distributions, Attendance).\n",
  DONOR:
    "\nThe person asking is a logged-in DONOR. Help them understand their donations, 80G receipts (Tax Centre), active pledges (Adopt-a-Medicine, animal sponsorship), and how campaigns work.\n",
  BENEFICIARY:
    "\nThe person asking is a logged-in BENEFICIARY (support recipient). Help them understand how to apply for ration kits, sanitary pads, medicines or other support via the 'Need help?' form on their portal home, how to track request status, and safety/awareness topics (cyber fraud, anti-drug, child safety). Be especially warm, non-judgemental and plain-spoken — avoid jargon.\n",
};

// POST /api/assistant/chat
router.post("/chat", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      message?: string;
      history?: ChatMessage[];
      role?: string;
      userName?: string;
    };
    const message = (body.message ?? "").trim();
    if (!message) return json(res, { error: "Message is required" }, 400);

    // The role gates access to ADMIN/VOLUNTEER-only live operations data
    // (inventory, donors, analytics) below, so it MUST come from the
    // verified session, never from the client-supplied request body.
    // validateSession (not the sync getSession) so a REVOKED token cannot
    // keep claiming a staff role; guests (no session) stay welcome.
    const session = await validateSession(req);
    const role = session?.role ?? "PUBLIC";

    // External-LLM cost control (gap A-7): 20 chats / hour, keyed by the
    // session userId when signed in, else by client IP — guests never 401.
    const rl = checkRateLimit(
      `assistant:chat:${session?.userId ?? clientIp(req.headers)}`,
      20,
      60 * 60 * 1000
    );
    if (!rl.allowed)
      return json(res, { error: "Too many requests — please try again in a while." }, 429);

    const history = (body.history ?? [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .slice(-8);

    // ── RAG retrieval ──────────────────────────────────────────────────────
    const chunks = retrieve(message, 5);
    const context =
      chunks.length > 0
        ? chunks.map((c) => `### ${c.title}\n${c.content}`).join("\n\n")
        : "(no specific entry — answer generally about UAR programmes and use helplines: 112 emergency, 108 ambulance, 1930 cyber, 181/1091 women, 1098 child, 14446 de-addiction, 14416 Tele-MANAS, 1962 animal)";

    // ── Live ops data (ADMIN/VOLUNTEER only, keyword-triggered) ────────────
    let liveContext = "";
    try {
      const sections = await buildLiveOpsContext(message, role);
      if (sections.length > 0) {
        liveContext = "\n\n" + sections.map((s) => `### ${s.title}\n${s.content}`).join("\n\n");
      }
    } catch (e) {
      log.warn("live_ops_snapshot_failed", { error: e instanceof Error ? e : String(e) });
    }

    const systemPrompt =
      SYSTEM_BASE +
      (ROLE_PROMPT[role] ?? "") +
      "\nKNOWLEDGE CONTEXT (most relevant excerpts for this question):\n" +
      context +
      liveContext;

    // ── LLM call (z-ai-web-dev-sdk, backend only) with robust fallback ────
    let reply = "";
    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: message },
        ],
      });
      reply =
        (completion as { choices?: { message?: { content?: string } }[] })
          ?.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      log.warn("llm_unavailable_kb_fallback", { error: e instanceof Error ? e : String(e) });
    }

    if (!reply) {
      // Fallback: answer directly from the best knowledge chunk so the
      // agent is ALWAYS available, even offline / API down.
      if (chunks.length > 0) {
        const top = chunks[0];
        reply = `${top.content.split("\n").slice(0, 14).join("\n")}\n\n(OFFLINE GUIDE MODE — for a fuller answer try again shortly. Emergency? 112 • Ambulance 108 • Cyber 1930 • Women 181 • Child 1098 • De-addiction 14446.)`;
      } else {
        reply = `I'm Angel, United Angel Reach's guide. I can help with anti-drug steps, cyber fraud rescue (call 1930 NOW if money was just stolen), women/child safety helplines, adopting a patient's monthly medicines, animal adoption & food pledges, our green-corridor ambulances, donations and volunteering. What do you need? (Emergency right now: 112)`;
      }
    }

    return json(res, {
      reply,
      sources: chunks.map((c) => ({ id: c.id, title: c.title })),
      suggestions: SUGGESTED_QUESTIONS.slice(0, 4),
      helplines: HELPLINES,
    });
  } catch (e) {
    return handleError(e, res);
  }
});
