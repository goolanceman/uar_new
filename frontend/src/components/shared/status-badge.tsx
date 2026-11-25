"use client";

/**
 * StatusBadge — unified status tone mapping used across every module.
 * One component instead of the six divergent StatusPill/Chip copies.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Tone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "progress"
  | "purple";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  success:
    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  warning:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  danger:
    "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
  info: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
  progress:
    "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30",
  purple:
    "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30",
};

/** Canonical status → tone map (extend per module as needed). */
const STATUS_TONE: Record<string, Tone> = {
  // donations / payments
  COMPLETED: "success", ISSUED: "success", APPROVED: "success", ACTIVE: "success",
  VERIFIED: "success", PUBLISHED: "success", AVAILABLE: "success", DELIVERED: "success",
  FULFILLED: "success", SETTLED: "success",
  PENDING: "warning", PARTIAL: "warning", IN_REVIEW: "warning", DOCUMENTS_REQUESTED: "warning",
  PAUSED: "warning", MAINTENANCE: "warning", FOSTERED: "warning", SEEKING: "warning",
  VERIFICATION: "warning", INTAKE: "warning", ASSIGNED: "warning", READY: "warning",
  FAILED: "danger", REFUNDED: "danger", REJECTED: "danger", CANCELLED: "danger",
  CRITICAL: "danger", SUSPENDED: "danger", DEPLETED: "danger", EXPIRED: "danger",
  REJECTED_CASE: "danger",
  // in-flight
  IN_PROGRESS: "progress", EN_ROUTE: "progress", DISPATCHED: "progress",
  SCANNED: "info", ADOPTED: "purple", DRAFT: "neutral",
  INACTIVE: "neutral", CLOSED: "neutral", ON_MISSION: "progress", REQUESTED: "warning",
  ARRIVED: "info", ONE_TIME: "neutral", RECURRING: "info", MONTHLY: "info",
};

export function toneForStatus(status?: string | null): Tone {
  if (!status) return "neutral";
  return STATUS_TONE[status.toUpperCase()] ?? "neutral";
}

export function StatusBadge({
  status,
  tone,
  className,
  children,
}: {
  status?: string | null;
  tone?: Tone;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = tone ?? toneForStatus(status);
  return (
    <Badge
      variant="outline"
      className={cn("font-medium whitespace-nowrap", TONE_CLASS[t], className)}
    >
      {children ?? humanize(status)}
    </Badge>
  );
}

export function humanize(status?: string | null): string {
  if (!status) return "—";
  return status
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
