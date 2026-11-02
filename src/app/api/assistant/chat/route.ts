import { retrieve, HELPLINES, SUGGESTED_QUESTIONS } from "@/lib/assistant-knowledge";
import { handleError, json } from "@/lib/session";

export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_BASE = `You are "Angel", the AI guide of United Angel Reach (UAR) — a charitable trust headquartered in Bengaluru, Karnataka, serving all of India. You appear as a floating agent on the trust's website.

Your style: warm, practical, concise, action-first. Use short paragraphs and numbered steps when giving instructions. Always give the exact helpline number when relevant. Never invent helpline numbers — only use the ones given. If someone is in immediate danger, tell them to call emergency services FIRST (112 police/fire/medical, 108 ambulance), then continue helping.

You help with: anti-drug guidance (de-addiction 14446, Tele-MANAS 14416, trafficking reports 1933), cyber fraud golden-hour rescue (1930, cybercrime.gov.in, Chakshu), women safety (112, 181, 1091), child safety & POCSO (1098, e-Box), Adopt-a-Medicine monthly tablet sponsorships, animal adoption & food pledges (1962), ration kit QR tracking, sanitary pad programme, the AI Green Corridor ambulance technology (5G V2X → BLE mesh → FM-RDS → smart siren fallback), donations with 80G receipts, and volunteering with an application→approval flow.

Answer in the language of the user's question (English, Hindi, Kannada etc.). Keep answers under ~250 words unless the user asks for detail. End with one helpful follow-up question or offer when natural.

KNOWLEDGE CONTEXT (most relevant excerpts for this question):
`;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      message?: string;
      history?: ChatMessage[];
    };
    const message = (body.message ?? "").trim();
    if (!message) return json({ error: "Message is required" }, 400);

    const history = (body.history ?? [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .slice(-8);

    // ── RAG retrieval ──────────────────────────────────────────────────────
    const chunks = retrieve(message, 5);
    const context =
      chunks.length > 0
        ? chunks.map((c) => `### ${c.title}\n${c.content}`).join("\n\n")
        : "(no specific entry — answer generally about UAR programmes and use helplines: 112 emergency, 108 ambulance, 1930 cyber, 181/1091 women, 1098 child, 14446 de-addiction, 14416 Tele-MANAS, 1962 animal)";

    const systemPrompt = SYSTEM_BASE + context;

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
      console.error("[assistant] LLM unavailable, using KB fallback", e);
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

    return json({
      reply,
      sources: chunks.map((c) => ({ id: c.id, title: c.title })),
      suggestions: SUGGESTED_QUESTIONS.slice(0, 4),
      helplines: HELPLINES,
    });
  } catch (e) {
    return handleError(e);
  }
}
