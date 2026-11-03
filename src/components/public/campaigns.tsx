"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { get } from "@/lib/api-client";
import { cn, formatNumber, titleCase } from "@/lib/utils";
import { formatINRCompact, formatDate } from "@/lib/format";
import { ViewSwitcher, useViewPref } from "@/components/shared/view-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section, EmptyState, CampaignIcon } from "@/components/public/shared";
import { CAMPAIGN_CONTENT, accentSoft } from "@/components/public/campaign-data";
import {
  CalendarDays,
  HandHeart,
  Info,
  Landmark,
  List,
  LayoutGrid,
  Phone,
  Search,
  SearchX,
  Siren,
  Users,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface LiveCampaign {
  id: string;
  title: string;
  slug?: string | null;
  tagline?: string | null;
  description?: string | null;
  category?: string | null;
  targetAmount: number;
  raisedAmount: number;
  beneficiaries: number;
  volunteersEngaged: number;
  helpline?: string | null;
  icon?: string | null;
  accent?: string | null;
  featured?: boolean;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  urgent?: boolean | null;
  taxEligible?: boolean | null;
  minDonation?: number | null;
}

type StatusFilter = "all" | "active" | "urgent" | "ending";
type SortKey = "featured" | "raised" | "ending" | "newest";

/** Days left until endDate (ceil); null when unknown. Negative = ended. */
function daysLeftOf(endDate?: string | null): number | null {
  if (!endDate) return null;
  const d = new Date(endDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

function daysActive(startDate?: string | null): number | null {
  if (!startDate) return null;
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function pctOf(c: LiveCampaign): number {
  return c.targetAmount > 0
    ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100))
    : 0;
}

/* ------------------------------------------------------------------ */
/* Badge cluster shared by grid + list views                           */
/* ------------------------------------------------------------------ */

function DaysLeftBadge({ left }: { left: number | null }) {
  if (left === null) return null;
  if (left < 0) {
    return (
      <Badge variant="outline" className="shrink-0 border-border text-[10px] text-muted-foreground">
        Ended
      </Badge>
    );
  }
  if (left === 0) {
    return (
      <Badge className="shrink-0 border-0 bg-red-500/15 text-[10px] text-red-600 dark:text-red-400">
        Ends today
      </Badge>
    );
  }
  if (left <= 7) {
    return (
      <Badge className="shrink-0 border-0 bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">
        {left}d left · ending soon
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
      {left}d left
    </Badge>
  );
}

function UrgentChip() {
  return (
    <Badge className="shrink-0 border-0 bg-red-500/15 text-[10px] font-bold text-red-600 dark:text-red-400">
      <Siren className="mr-1 size-3" aria-hidden /> Urgent
    </Badge>
  );
}

function TaxEligibleChip() {
  return (
    <Badge className="shrink-0 border-0 bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">
      <Landmark className="mr-1 size-3" aria-hidden /> 80G eligible
    </Badge>
  );
}

/* ================================================================== */
/* CampaignsPage                                                       */
/* ================================================================== */

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<LiveCampaign[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("ALL");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("featured");
  const [view, setView] = useViewPref("public-campaigns", "grid");

  useEffect(() => {
    let alive = true;
    get<LiveCampaign[]>("/api/campaigns")
      .then((d) => alive && setCampaigns(Array.isArray(d) ? d : []))
      .catch(() => alive && setCampaigns([]));
    return () => {
      alive = false;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    (campaigns ?? []).forEach((c) => c.category && set.add(c.category));
    return Array.from(set).sort();
  }, [campaigns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = [...(campaigns ?? [])];

    if (category !== "ALL") list = list.filter((c) => c.category === category);
    if (q) {
      list = list.filter((c) =>
        [c.title, c.tagline, c.description]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))
      );
    }

    switch (status) {
      case "active":
        list = list.filter((c) => (c.status ?? "ACTIVE") === "ACTIVE");
        break;
      case "urgent":
        list = list.filter((c) => c.urgent === true);
        break;
      case "ending": {
        list = list.filter((c) => {
          const left = daysLeftOf(c.endDate);
          return left !== null && left >= 0 && left <= 7;
        });
        break;
      }
    }

    switch (sort) {
      case "featured":
        list.sort(
          (a, b) =>
            Number(b.featured ?? false) - Number(a.featured ?? false) ||
            b.raisedAmount - a.raisedAmount
        );
        break;
      case "raised":
        list.sort((a, b) => b.raisedAmount - a.raisedAmount);
        break;
      case "ending":
        list.sort((a, b) => {
          const la = daysLeftOf(a.endDate);
          const lb = daysLeftOf(b.endDate);
          if (la === null && lb === null) return 0;
          if (la === null) return 1;
          if (lb === null) return -1;
          return la - lb;
        });
        break;
      case "newest":
        list.sort(
          (a, b) =>
            (b.startDate ? new Date(b.startDate).getTime() : 0) -
            (a.startDate ? new Date(a.startDate).getTime() : 0)
        );
        break;
    }
    return list;
  }, [campaigns, search, category, status, sort]);

  const filtersDirty = search !== "" || category !== "ALL" || status !== "all";

  return (
    <Section
      title="All programmes"
      subtitle="Nine long-term campaigns — each one an educational resource, a rescue service and a funding pipeline at once."
    >
      {/* ---------------- Toolbar ---------------- */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search programmes…"
              className="h-11 pl-9"
              aria-label="Search programmes"
            />
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <span className="hidden text-xs font-semibold text-muted-foreground sm:block">
              Sort
            </span>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger
                className="h-11 w-full sm:w-[180px]"
                aria-label="Sort programmes"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="featured">Featured</SelectItem>
                <SelectItem value="raised">Most funded</SelectItem>
                <SelectItem value="ending">Ending soon</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
              </SelectContent>
            </Select>
            <div className="hidden md:block">
              <ViewSwitcher
                value={view}
                onChange={setView}
                options={["grid", "list"]}
                aria-label="Switch between grid and list view"
              />
            </div>
          </div>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Status
          </span>
          {(
            [
              { v: "all", label: "All" },
              { v: "active", label: "Active" },
              { v: "urgent", label: "Urgent" },
              { v: "ending", label: "Ending soon" },
            ] as const
          ).map((s) => (
            <button
              key={s.v}
              onClick={() => setStatus(s.v)}
              aria-pressed={status === s.v}
              className={cn(
                "min-h-[36px] rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                status === s.v
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          <button
            onClick={() => setCategory("ALL")}
            aria-pressed={category === "ALL"}
            className={cn(
              "min-h-[36px] rounded-full px-3.5 py-1.5 text-sm font-medium transition",
              category === "ALL"
                ? "bg-emerald-600 text-white"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            All causes
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
              className={cn(
                "min-h-[36px] rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                category === cat
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {titleCase(cat)}
            </button>
          ))}
          {/* Mobile view switcher */}
          <div className="ml-auto md:hidden">
            <ViewSwitcher value={view} onChange={setView} options={["grid", "list"]} />
          </div>
        </div>
      </div>

      {/* Result count */}
      {campaigns !== null && (
        <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
          Showing <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
          of {campaigns.length} programmes
          {search.trim() ? (
            <>
              {" "}
              for <span className="font-semibold text-foreground">“{search.trim()}”</span>
            </>
          ) : null}
        </p>
      )}

      {/* ---------------- Content ---------------- */}
      {campaigns === null ? (
        view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-72 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No programmes match"
          hint={
            filtersDirty
              ? "Nothing matches this combination of filters. Try a different word, or clear them."
              : "No campaigns here yet — check back soon."
          }
          action={
            filtersDirty ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setCategory("ALL");
                  setStatus("all");
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : view === "list" ? (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y" aria-label="Programmes list">
            {filtered.map((c) => {
              const content = CAMPAIGN_CONTENT[c.slug ?? ""];
              const a = accentSoft(c.accent ?? content?.accent);
              const pct = pctOf(c);
              const left = daysLeftOf(c.endDate);
              return (
                <li
                  key={c.id}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11",
                      a.chip,
                      a.text
                    )}
                    aria-hidden
                  >
                    <CampaignIcon icon={c.icon ?? content?.icon ?? "heart"} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={`/campaigns/${c.slug}`}
                        className="truncate font-semibold hover:underline"
                      >
                        {c.title}
                      </Link>
                      {c.featured && (
                        <Badge className="shrink-0 border-0 bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">
                          Featured
                        </Badge>
                      )}
                      {c.urgent && <UrgentChip />}
                      {c.taxEligible && <TaxEligibleChip />}
                      <DaysLeftBadge left={left} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {titleCase(c.category)} ·{" "}
                      <span className="font-semibold text-foreground">
                        {formatINRCompact(c.raisedAmount)}
                      </span>{" "}
                      of {formatINRCompact(c.targetAmount)} ({pct}%)
                      {c.endDate ? ` · ends ${formatDate(c.endDate)}` : ""}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <Progress value={pct} className="h-1.5 w-28" aria-label={`${pct}% raised`} />
                    {c.minDonation && c.minDonation > 0 && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Min gift {formatINRCompact(c.minDonation)}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className={cn("shrink-0 text-white", a.solid)}
                    asChild
                  >
                    <Link href={`/donate?campaign=${c.slug}`}>Donate</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const content = CAMPAIGN_CONTENT[c.slug ?? ""];
            const a = accentSoft(c.accent ?? content?.accent);
            const pct = pctOf(c);
            const active = daysActive(c.startDate);
            const left = daysLeftOf(c.endDate);
            return (
              <Card
                key={c.id}
                className={cn(
                  "flex flex-col overflow-hidden border p-0 transition-all hover:-translate-y-0.5 hover:shadow-md",
                  a.border
                )}
              >
                <div className={cn("h-1.5 w-full", a.chip)} aria-hidden />
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl",
                        a.chip,
                        a.text
                      )}
                    >
                      <CampaignIcon
                        icon={c.icon ?? content?.icon ?? "heart"}
                        className="size-6"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="font-semibold leading-snug">{c.title}</h3>
                        {c.featured && (
                          <Badge className="shrink-0 border-0 bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">
                            Featured
                          </Badge>
                        )}
                        {pct >= 100 && (
                          <Badge className="shrink-0 border-0 bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">
                            Goal reached
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {titleCase(c.category)} · {c.status ? titleCase(c.status) : "Active"}
                      </p>
                    </div>
                  </div>

                  {/* Status badge row */}
                  {(c.urgent || c.taxEligible || left !== null) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.urgent && <UrgentChip />}
                      {c.taxEligible && <TaxEligibleChip />}
                      <DaysLeftBadge left={left} />
                    </div>
                  )}

                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {c.tagline ?? content?.heroTag ?? c.description}
                  </p>

                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden />
                      {formatNumber(c.beneficiaries)} beneficiaries
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <HandHeart className="size-3.5" aria-hidden />
                      {formatNumber(c.volunteersEngaged)} volunteers
                    </span>
                    {active !== null && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="size-3.5" aria-hidden />
                        {active}d active
                      </span>
                    )}
                    {c.helpline && (
                      <a
                        href={`tel:${c.helpline}`}
                        className="inline-flex min-h-[44px] items-center gap-1 font-semibold text-emerald-600 hover:underline dark:text-emerald-400 sm:min-h-0"
                        aria-label={`Call helpline ${c.helpline}`}
                      >
                        <Phone className="size-3.5" aria-hidden />
                        {c.helpline}
                      </a>
                    )}
                  </div>

                  <div>
                    <Progress value={pct} className="h-2" aria-label={`${pct}% raised`} />
                    <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {formatINRCompact(c.raisedAmount)}
                      </span>
                      <span>
                        {pct}% of {formatINRCompact(c.targetAmount)}
                      </span>
                    </div>
                  </div>

                  {c.minDonation && c.minDonation > 0 && (
                    <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <Info className="size-3 shrink-0" aria-hidden />
                      Minimum online gift {formatINRCompact(c.minDonation)}
                    </p>
                  )}

                  {c.startDate && (
                    <p className="text-[11px] text-muted-foreground">
                      Running since {formatDate(c.startDate)}
                      {c.endDate && left !== null && left >= 0
                        ? ` · closes ${formatDate(c.endDate)}`
                        : ""}
                    </p>
                  )}

                  <div className="mt-auto flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <Link href={`/campaigns/${c.slug}`}>Learn more</Link>
                    </Button>
                    <Button
                      size="sm"
                      className={cn("flex-1 text-white", a.solid)}
                      asChild
                    >
                      <Link href={`/donate?campaign=${c.slug}`}>Donate</Link>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* Keep icons referenced for readability of the toolbar row */
void List;
void LayoutGrid;
