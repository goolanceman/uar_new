"use client";

/**
 * Food Security — AI Insights tab.
 * Advisory-only AI over authorised aggregates: distribution planning,
 * demand forecasting, natural-language analytics and waste prevention.
 * Every run is logged (AIInteraction, PENDING, digest-only) and output
 * requires human action through normal APIs — the AI can change nothing.
 */

import { useEffect, useState } from "react";
import { CalendarPlus, Loader2, Sparkles, Trash2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { get, post } from "@/lib/api-client";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { TextareaField } from "@/components/shared/form-fields";
import { asArray, type FoodEvent, type TabProps } from "./shared";

type Mode = "plan" | "forecast" | "analytics" | "waste";

export default function InsightsTab({ revision, isAdmin }: TabProps) {
  const [mode, setMode] = useState<Mode>("plan");
  const [events, setEvents] = useState<FoodEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [question, setQuestion] = useState("");
  const [output, setOutput] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const loadEvents = async () => {
    try {
      const evts = asArray<FoodEvent>(await get("/api/food/events"));
      setEvents(evts.filter((e) => ["APPROVED", "PUBLISHED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "PLANNING"].includes(e.status)));
    } catch {
      setEvents([]);
    }
  };

  useEffect(() => {
    if (isAdmin) loadEvents();
  }, [isAdmin, revision]);

  const run = async (m: Mode) => {
    setMode(m);
    setBusy(true);
    setOutput("");
    try {
      const body: Record<string, unknown> = { mode: m };
      if (m === "plan") {
        if (!eventId) {
          toast.error("Pick an upcoming distribution event first");
          return;
        }
        body.eventId = eventId;
      }
      if (m === "analytics") {
        if (question.trim().length < 5) {
          toast.error("Type a question first");
          return;
        }
        body.question = question;
      }
      const res = await post<{ output: string }>("/api/food/insights", body);
      setOutput(res.output);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI is unavailable right now");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setOutput("");
    setQuestion("");
  };

  const CARDS: Array<{ key: Mode; title: string; desc: string; icon: React.ReactNode; cta: string }> = [
    { key: "plan", title: "Distribution planning assistant", desc: "Package counts, stock shortfalls, volunteer needs and cost estimate for one event.", icon: <CalendarPlus className="size-5" />, cta: "Plan this event" },
    { key: "forecast", title: "Demand forecasting", desc: "Estimates demand from historical distributions, applications and stock consumption.", icon: <TrendingUp className="size-5" />, cta: "Forecast demand" },
    { key: "analytics", title: "Ask your food data", desc: "Natural-language analytics over authorised aggregates — answers cite the reporting period.", icon: <Sparkles className="size-5" />, cta: "Ask" },
    { key: "waste", title: "Waste prevention", desc: "Redirects expiring stock to upcoming programmes before safe-use deadlines. Never suggests expired or quarantined food.", icon: <Trash2 className="size-5" />, cta: "Find at-risk stock" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => (
          <SectionCard key={c.key} title={c.title} description={c.desc} icon={c.icon}>
            <div className="px-5 pb-5">
              {c.key === "plan" && (
                <select
                  aria-label="Event to plan"
                  className="mb-3 h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                >
                  <option value="">Select an upcoming event…</option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>{e.code} — {e.title}</option>
                  ))}
                </select>
              )}
              {c.key === "analytics" && (
                <div className="mb-3">
                  <TextareaField
                    label="Your question"
                    value={question}
                    onChange={setQuestion}
                    placeholder="How many families received grocery kits this month? Which locations have the highest pending applications?"
                  />
                </div>
              )}
              <Button size="sm" onClick={() => run(c.key)} disabled={busy || !isAdmin}>
                {busy && mode === c.key ? <Loader2 className="size-4 animate-spin" /> : c.cta}
              </Button>
            </div>
          </SectionCard>
        ))}
      </div>

      {output && (
        <SectionCard
          title="AI suggestion"
          description="Advisory only — a human reviews and acts through the normal screens. Logged for audit."
          icon={<Sparkles className="size-4" />}
          actions={<Button variant="outline" size="sm" onClick={reset}>Clear</Button>}
        >
          <div className="whitespace-pre-wrap px-5 pb-5 text-sm leading-relaxed">{output}</div>
        </SectionCard>
      )}

      {!output && !busy && (
        <EmptyState
          icon={<Sparkles className="size-8" />}
          title="No AI suggestions yet"
          hint="All insights run on live platform data, state their assumptions, and never take actions on their own."
          className="border-0"
        />
      )}
    </div>
  );
}
