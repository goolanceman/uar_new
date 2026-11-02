"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { get } from "@/lib/api-client";
import { cn, formatINR, formatNumber, titleCase } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Section, EmptyState, CampaignIcon, accentClasses } from "@/components/public/shared";
import { CAMPAIGN_CONTENT } from "@/components/public/campaign-data";
import { HandHeart, Phone, Search, SearchX, Users } from "lucide-react";

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
}

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<LiveCampaign[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("ALL");

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
    list.sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));
    if (category !== "ALL") list = list.filter((c) => c.category === category);
    if (q) {
      list = list.filter((c) =>
        [c.title, c.tagline, c.description]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))
      );
    }
    return list;
  }, [campaigns, search, category]);

  return (
    <Section
      title="All programmes"
      subtitle="Nine long-term campaigns — each one an educational resource, a rescue service and a funding pipeline at once."
    >
      {/* Search + category chips */}
      <div className="mb-6 space-y-3">
        <div className="relative max-w-md">
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
            All
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
        </div>
      </div>

      {/* Cards */}
      {campaigns === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No programmes match"
          hint={
            search
              ? `Nothing found for “${search}”. Try a different word, or clear the filters.`
              : "No campaigns in this category yet — check back soon."
          }
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setCategory("ALL");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const content = CAMPAIGN_CONTENT[c.slug ?? ""];
            const accent = c.accent ?? content?.accent ?? "emerald";
            const icon = c.icon ?? content?.icon ?? "heart";
            const a = accentClasses(accent);
            const pct =
              c.targetAmount > 0
                ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100))
                : 0;
            return (
              <Card key={c.id} className="flex flex-col overflow-hidden p-0">
                <div className={cn("h-1.5 w-full", a.bg500)} aria-hidden />
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl",
                        a.bg100,
                        a.text700
                      )}
                    >
                      <CampaignIcon icon={icon} className="size-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="font-semibold leading-snug">{c.title}</h3>
                        {c.featured && (
                          <Badge className={cn("shrink-0 border-0 text-[10px] text-white", a.bg500)}>
                            Featured
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {titleCase(c.category)} · {c.status ? titleCase(c.status) : "Active"}
                      </p>
                    </div>
                  </div>

                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {c.tagline ?? content?.short ?? c.description}
                  </p>

                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden />
                      {formatNumber(c.beneficiaries)} beneficiaries
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <HandHeart className="size-3.5" aria-hidden />
                      {formatNumber(c.volunteersEngaged)} volunteers
                    </span>
                    {c.helpline && (
                      <a
                        href={`tel:${c.helpline}`}
                        className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                      >
                        <Phone className="size-3.5" aria-hidden />
                        {c.helpline}
                      </a>
                    )}
                  </div>

                  <div>
                    <Progress value={pct} className="h-2" aria-label={`${pct}% raised`} />
                    <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{formatINR(c.raisedAmount)}</span>
                      <span>{pct}% of {formatINR(c.targetAmount)}</span>
                    </div>
                  </div>

                  <div className="mt-auto flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <Link href={`/campaigns/${c.slug}`}>Learn more</Link>
                    </Button>
                    <Button
                      size="sm"
                      className={cn("flex-1 text-white", a.bg500, "hover:opacity-90")}
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
