"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Phone, Send, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { get, post } from "@/lib/api-client";
import { SUGGESTED_QUESTIONS } from "@/lib/assistant-knowledge";
import type { SessionUser } from "@/hooks/use-auth";

interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: { id: string; title: string }[];
}

/** Dispatch this anywhere in the app to open Angel pre-filled with a question:
 *  window.dispatchEvent(new CustomEvent(ANGEL_ASK_EVENT, { detail: { question } })) */
export const ANGEL_ASK_EVENT = "angel:ask";

const QUICK_HELPLINES = [
  { label: "112 Police/Fire", tel: "112" },
  { label: "108 Ambulance", tel: "108" },
  { label: "1930 Cyber", tel: "1930" },
  { label: "1098 Child", tel: "1098" },
];

const ROLE_GREETING: Record<string, string> = {
  ADMIN:
    "Namaste! I'm Angel 🕊️ — your ops copilot. Ask me to check inventory stock, summarise analytics, see today's distributions, volunteer workload, or campaign/cause/animal/ambulance status. I'll pull live numbers for you.",
  VOLUNTEER:
    "Namaste! I'm Angel 🕊️. Ask me about your assigned tasks, today's distributions, kit batches, or how to log attendance and complete a task.",
  DONOR:
    "Namaste! I'm Angel 🕊️. Ask me about your donations, 80G receipts, active pledges, sponsored animals, or how a campaign works.",
  BENEFICIARY:
    "Namaste! I'm Angel 🕊️. Ask me about applying for ration kits, sanitary pads or medicines, your request status, or safety topics like cyber fraud, anti-drug help and child safety.",
};

const ROLE_QUICK_ACTIONS: Record<string, string[]> = {
  ADMIN: [
    "What inventory items are low on stock?",
    "Show today's analytics summary",
    "Which volunteers have the lightest task load?",
    "How many distributions happened this month?",
  ],
  VOLUNTEER: [
    "What tasks are assigned to me?",
    "How do I mark a task complete?",
    "What's today's distribution schedule?",
  ],
  DONOR: [
    "Where can I download my 80G receipt?",
    "How does Adopt-a-Medicine work?",
    "Show my active pledges",
  ],
  BENEFICIARY: [
    "How do I apply for a ration kit?",
    "How do I apply for sanitary pads?",
    "Tell me about cyber fraud safety",
    "Tell me about anti-drug awareness",
  ],
};

export function AssistantWidget({ user }: { user?: SessionUser | null }) {
  const role = user?.role;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        (role && ROLE_GREETING[role]) ||
        "Namaste! I'm Angel 🕊️, the United Angel Reach guide. Ask me about anti-drug help, cyber fraud rescue, women/child safety, adopting a patient's medicines, animal adoption, our green-corridor ambulances, donating or volunteering.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [assistEnabled, setAssistEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Feature-flag gate: /api/settings/public publishes assist.enabled. When the
  // flag is explicitly false the widget renders nothing at all; when the fetch
  // fails the widget stays visible (network-resilient default: enabled).
  useEffect(() => {
    let cancelled = false;
    get<{ features?: Record<string, boolean> }>("/api/settings/public")
      .then((d) => {
        if (!cancelled && d?.features?.["assist.enabled"] === false) setAssistEnabled(false);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await post<{ reply: string; sources: { id: string; title: string }[] }>(
        "/api/assistant/chat",
        {
          message: q,
          history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          role: role ?? "PUBLIC",
          userName: user?.name,
        }
      );
      setMessages([...next, { role: "assistant", content: res.reply, sources: res.sources }]);
    } catch {
      setMessages([
        ...next,
        {
          role: "assistant",
          content:
            "I couldn't reach my knowledge service. If this is an emergency: 112 police • 108 ambulance • 1930 cyber fraud • 181 women • 1098 child • 14446 de-addiction. Please try me again in a moment.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // Let any page open Angel pre-filled with a question (e.g. "Ask Angel"
  // buttons on awareness/help-centre content, adoption explainers, etc.)
  useEffect(() => {
    const handler = (e: Event) => {
      if (!assistEnabled) return;
      const detail = (e as CustomEvent<{ question?: string }>).detail;
      const q = detail?.question?.trim();
      setOpen(true);
      if (q) void send(q);
    };
    window.addEventListener(ANGEL_ASK_EVENT, handler);
    return () => window.removeEventListener(ANGEL_ASK_EVENT, handler);
  }, [messages, role, assistEnabled]);

  const quickActions = (role && ROLE_QUICK_ACTIONS[role]) || SUGGESTED_QUESTIONS.slice(0, 4);

  // Flag off → render nothing (launcher and panel both disappear).
  if (!assistEnabled) return null;

  return (
    <>
      {/* Launcher */}
      <button
        aria-label="Open Angel AI assistant"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed bottom-5 right-5 z-50 flex size-14 items-center justify-center rounded-full",
          "bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105 active:scale-95",
          open && "rotate-90"
        )}
      >
        {!open && (
          <span className="absolute inset-0 rounded-full bg-primary/60 animate-pulse-ring" />
        )}
        {open ? <X className="size-6" /> : <Bot className="size-7" />}
      </button>

      {/* Panel */}
      {open && (
        <div
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border bg-card shadow-2xl",
            "inset-x-3 bottom-24 top-20 rounded-2xl sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[560px] sm:max-h-[75vh] sm:w-[400px]"
          )}
          role="dialog"
          aria-label="Angel AI assistant chat"
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex size-9 items-center justify-center rounded-full bg-white/20">
              <Sparkles className="size-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold leading-tight">Angel — AI Guide</p>
              <p className="text-xs opacity-80">
                {role === "ADMIN"
                  ? "Ops copilot · Inventory · Analytics · Tasks"
                  : role === "VOLUNTEER"
                    ? "Tasks · Distributions · Attendance"
                    : role === "DONOR"
                      ? "Receipts · Pledges · Campaigns"
                      : role === "BENEFICIARY"
                        ? "Apply for support · Safety topics"
                        : "Anti-drug · Cyber · Safety · Health · Animals"}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Helpline chips */}
          <div className="flex gap-1.5 overflow-x-auto border-b bg-secondary px-3 py-2 scrollbar-thin">
            {QUICK_HELPLINES.map((h) => (
              <a
                key={h.tel}
                href={`tel:${h.tel}`}
                className="flex shrink-0 items-center gap-1 rounded-full bg-background px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-border transition hover:bg-accent"
              >
                <Phone className="size-3 text-primary" />
                {h.label}
              </a>
            ))}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3 scrollbar-thin">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md bg-muted text-foreground"
                  )}
                >
                  {m.content}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.sources.map((s) => (
                        <span key={s.id} className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {s.title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Angel is thinking…
                </div>
              </div>
            )}
            {messages.length <= 1 && (
              <div className="space-y-1.5 pt-1">
                <p className="px-1 text-xs font-medium text-muted-foreground">Try asking:</p>
                {quickActions.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-left text-xs text-foreground transition hover:bg-accent"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 border-t p-2.5">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask Angel anything…"
              aria-label="Message to Angel"
            />
            <Button size="icon" onClick={() => send()} disabled={busy || !input.trim()} aria-label="Send">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
