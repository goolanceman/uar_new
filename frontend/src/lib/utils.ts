import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Shared UI helpers. ALL formatting primitives (money, numbers, dates,
 * amount-in-words, titles, relative time) live in @/lib/format — the single
 * implementation — and are re-exported here so the historic "@/lib/utils"
 * import path keeps compiling across the repo. Only `cn` and `pct` are
 * defined here; do not add new formatting helpers to this file.
 */
export {
  amountInWords,
  financialYear,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatDuration,
  formatINR,
  formatINRCompact,
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  initials,
  numberToWords,
  timeAgo,
  titleCase,
} from "@/lib/format";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}
