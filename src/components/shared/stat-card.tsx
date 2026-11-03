"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type StatAccent =
  | "emerald"
  | "orange"
  | "cyan"
  | "fuchsia"
  | "amber"
  | "teal"
  | "lime"
  | "red"
  | "pink";

/**
 * Static class map — real Tailwind classes only (no dynamic string building),
 * with dark-mode-safe opacity variants.
 */
const ACCENTS: Record<StatAccent, { chip: string; glow: string }> = {
  emerald: {
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    glow: "bg-emerald-500/15",
  },
  orange: {
    chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    glow: "bg-orange-500/15",
  },
  cyan: {
    chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    glow: "bg-cyan-500/15",
  },
  fuchsia: {
    chip: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
    glow: "bg-fuchsia-500/15",
  },
  amber: {
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    glow: "bg-amber-500/15",
  },
  teal: {
    chip: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    glow: "bg-teal-500/15",
  },
  lime: {
    chip: "bg-lime-500/10 text-lime-600 dark:text-lime-400",
    glow: "bg-lime-500/15",
  },
  red: {
    chip: "bg-red-500/10 text-red-600 dark:text-red-400",
    glow: "bg-red-500/15",
  },
  pink: {
    chip: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
    glow: "bg-pink-500/15",
  },
};

/**
 * StatCard — KPI tile with accent icon chip, big value, muted label/hint and a
 * soft corner glow. Shows Skeleton placeholders while `loading`.
 */
export function StatCard({
  label,
  value,
  icon,
  accent,
  hint,
  loading,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  accent?: string;
  hint?: React.ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const a = ACCENTS[(accent ?? "emerald") as StatAccent] ?? ACCENTS.emerald;

  return (
    <div
      className={cn(
        "card-hover relative overflow-hidden rounded-xl border bg-card p-4 text-card-foreground sm:p-5",
        className
      )}
    >
      {/* decorative accent glow */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 size-28 rounded-full blur-2xl",
          a.glow
        )}
      />
      {loading ? (
        <div className="relative flex items-start gap-3">
          {icon && <Skeleton className="size-10 shrink-0 rounded-xl" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ) : (
        <div className="relative flex items-start gap-3">
          {icon && (
            <span
              aria-hidden="true"
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                a.chip
              )}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 truncate text-2xl font-bold leading-tight tracking-tight">
              {value}
            </p>
            {hint && (
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StatCard;
