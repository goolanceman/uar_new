"use client";

/**
 * Health Programme — AI Insights tab (ADMIN only, hidden for other roles).
 *
 *  - Camp-planning assistant: POST /api/health-ai {action:"camp-plan"} with
 *    city/date/notes; the (mock or real) response text is shown and the
 *    interaction is saved as PENDING.
 *  - Review queue: AIInteraction rows with Approve/Reject — human review is
 *    enforced in the UI (nothing auto-applies) AND server-side per contract.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Loader2,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { TabProps } from "./overview";
import {
  asItems,
  errorText,
  NoteBox,
  type AiInteractionRow,
} from "./shared";

export default function AiInsightsTab({ revision }: TabProps) {
  const [rows, setRows] = useState<AiInteractionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [city, setCity] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await get<unknown>("/api/health-ai");
      const list = asItems<AiInteractionRow>(d).slice();
      list.sort((a, b) => {
        const rank = (r: AiInteractionRow) => (r.status === "PENDING" ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
      });
      setRows(list);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, revision]);

  const runPlan = async () => {
    if (!city.trim()) {
      toast.error("Add a city or area to plan for");
      return;
    }
    setRunning(true);
    setOutput(null);
    try {
      const d = await post<unknown>("/api/health-ai", {
        action: "camp-plan",
        city: city.trim(),
        when: when.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      const text =
        (d as { plan?: string }).plan ??
        (d as { output?: string }).output ??
        (d as { result?: string }).result ??
        (d as { interaction?: { output?: string } }).interaction?.output ??
        JSON.stringify(d, null, 2);
      setOutput(typeof text === "string" ? text : JSON.stringify(d, null, 2));
      toast.success("Camp plan drafted — saved below for review");
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setRunning(false);
    }
  };

  const review = async (row: AiInteractionRow, status: "APPROVED" | "REJECTED") => {
    setActingId(row.id);
    try {
      await patch(`/api/health-ai/${row.id}`, { status });
      toast.success(`AI output ${status.toLowerCase()}`);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setActingId(null);
    }
  };

  const pending = (rows ?? []).filter((r) => r.status === "PENDING");

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-3 lg:gap-6 lg:space-y-0">
      {/* planner */}
      <div className="space-y-4 lg:col-span-2">
        <SectionCard
          title="Camp planner"
          description="Ask the health AI where and when the next camp should run."
          icon={<Sparkles className="size-4" aria-hidden="true" />}
        >
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                City / area<span className="ml-0.5 text-destructive">*</span>
                <Textarea
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Yelahanka, Bengaluru"
                  rows={1}
                  className="min-h-11 sm:min-h-9"
                  aria-label="City or area for the camp plan"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                Target window
                <Textarea
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  placeholder="e.g. next month, second Saturday"
                  rows={1}
                  className="min-h-11 sm:min-h-9"
                  aria-label="Target window for the camp plan"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Constraints & notes
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Focus on BP + diabetes screening; partner hospital available weekends"
                rows={3}
                aria-label="Constraints and notes for the camp plan"
              />
            </label>
            <div className="flex items-center gap-2">
              <Button className="min-h-11 sm:min-h-9" onClick={runPlan} disabled={running}>
                {running ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                {running ? "Thinking…" : "Draft camp plan"}
              </Button>
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={load} aria-label="Refresh AI interactions">
                <RefreshCw className="size-4" aria-hidden="true" /> Refresh
              </Button>
            </div>
            {output ? (
              <div className="rounded-xl border bg-muted/30 px-4 py-3" aria-live="polite">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Draft plan</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{output}</p>
              </div>
            ) : null}
          </div>
        </SectionCard>

        {/* review queue */}
        <SectionCard
          title="AI output review"
          description="Nothing from the AI applies on its own — approve or reject every draft."
          icon={<Check className="size-4" aria-hidden="true" />}
          actions={
            <Badge
              variant="outline"
              className={
                pending.length > 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              }
            >
              {pending.length} pending
            </Badge>
          }
        >
          {error ? (
            <EmptyState icon={<Sparkles className="size-8" aria-hidden="true" />} title="AI interactions could not load" hint={error}>
              <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
                Retry
              </Button>
            </EmptyState>
          ) : loading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : (rows ?? []).length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-8" aria-hidden="true" />}
              title="No AI interactions yet"
              hint="Draft a camp plan above — every AI output lands here for human review before anyone acts on it."
            />
          ) : (
            <ul className="space-y-2" aria-label="AI interactions">
              {(rows ?? []).map((r) => (
                <li key={r.id} className="rounded-xl border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-medium">{humanize(r.kind ?? "CAMP_PLAN")}</Badge>
                    <StatusBadge status={r.status} />
                    <span className="ml-auto text-xs text-muted-foreground">{r.createdAt ? formatDateTime(r.createdAt) : "—"}</span>
                  </div>
                  {r.input ? <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">Input: {r.input}</p> : null}
                  {r.output ? (
                    <p className="mt-1 whitespace-pre-wrap rounded-lg border bg-muted/30 px-3 py-2 text-sm leading-relaxed">
                      {r.output}
                    </p>
                  ) : null}
                  {r.status === "PENDING" ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        className="min-h-9"
                        disabled={actingId === r.id}
                        onClick={() => review(r, "APPROVED")}
                      >
                        <ThumbsUp className="size-3.5" aria-hidden="true" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                        disabled={actingId === r.id}
                        onClick={() => review(r, "REJECTED")}
                      >
                        <ThumbsDown className="size-3.5" aria-hidden="true" /> Reject
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* guardrails */}
      <div className="space-y-4">
        <SectionCard title="Guardrails" description="How AI is allowed to help.">
          <div className="space-y-2">
            <NoteBox>AI drafts only — a human approves before anything is applied.</NoteBox>
            <NoteBox>Plans use aggregated camp data; no beneficiary-identifiable information is sent.</NoteBox>
            <NoteBox>Every interaction is logged with its prompt, output and reviewer decision.</NoteBox>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
