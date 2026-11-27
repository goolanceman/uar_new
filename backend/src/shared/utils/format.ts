/**
 * Shared formatting utilities — multi-currency money, amount-in-words,
 * dates and identifiers. Used by receipts, certificates, reports and views.
 * Zero-redundancy rule: import from here instead of re-implementing.
 */

import {
  DEFAULT_CURRENCY,
  currencyUnitName,
  formatMoney as formatMoneyBase,
  getCurrency,
} from "@/domains/settings-core";

/* ------------------------------- currency --------------------------------- */

/** Single money-formatting implementation lives in settings-core (client-safe
 * currency catalog). Re-exported here for convention — every view/route should
 * import it from this module. */
export { formatMoney, DEFAULT_CURRENCY } from "@/domains/settings-core";

/**
 * INR-only convenience wrapper kept for the many existing call sites.
 * New code should prefer currency-aware `formatMoney(amount, code)`.
 *
 * @deprecated use `formatMoney(amount, code)` instead
 */
export function formatINR(amount: number | string | null | undefined): string {
  return formatMoneyBase(amount, "INR");
}

/**
 * Grouped number for KPI cards and counts (Indian digit grouping).
 * Moved here from @/lib/utils — the single implementation.
 */
export function formatNumber(n: number | undefined | null): string {
  if (!n) return "0";
  return n.toLocaleString("en-IN");
}

export function formatINRCompact(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  if (Number.isNaN(n)) return "₹0";
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

/**
 * Compact money for KPI cards and chart axes. INR keeps the Indian
 * Crore/Lakh/K units; every other currency uses Intl compact notation with
 * its own symbol (e.g. "$1.5M", "AED 12.5K").
 */
export function formatMoneyCompact(
  amount: number | string | null | undefined,
  code: string = DEFAULT_CURRENCY
): string {
  const n = Number(amount ?? 0);
  if (code === "INR") return formatINRCompact(n);
  const cur = getCurrency(code);
  if (Number.isNaN(n)) return `${cur.symbol}0`;
  return `${cur.symbol}${new Intl.NumberFormat(cur.locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n)}`;
}

/* --------------------------- amount in words ------------------------------ */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** Scale tables for the two numbering systems, largest unit first. */
const WESTERN_SCALES: ReadonlyArray<readonly [number, string]> = [
  [1_000_000_000, "Billion"], [1_000_000, "Million"], [1_000, "Thousand"],
];
const INDIAN_SCALES: ReadonlyArray<readonly [number, string]> = [
  [1_00_00_000, "Crore"], [1_00_000, "Lakh"], [1_000, "Thousand"],
];

/** Walks a scale table, e.g. 125000 + INDIAN_SCALES → "One Lakh Twenty Five Thousand". */
function scaleWords(
  n: number,
  scales: ReadonlyArray<readonly [number, string]>
): string {
  if (n <= 0) return "";
  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of scales) {
    const q = Math.floor(rest / value);
    if (q > 0) {
      // quotients above 999 recurse so huge amounts keep correct words
      parts.push(`${q > 999 ? scaleWords(q, scales) : threeDigits(q)} ${name}`);
      rest %= value;
    }
  }
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/**
 * Integer → English words using the Western system
 * (thousand / million / billion), e.g. 1500 → "One Thousand Five Hundred".
 * Shared by the currency-specific amount-in-words paths.
 */
export function numberToWords(n: number): string {
  const num = Math.floor(Math.abs(Number(n) || 0));
  if (num === 0) return "Zero";
  return scaleWords(num, WESTERN_SCALES);
}

/**
 * Amount in words for receipts.
 *  · INR (default) uses the Indian numbering system with Rupees/Paise:
 *    "Rupees One Lakh Twenty Five Thousand Only"
 *  · every other currency uses the Western system with the currency's own
 *    unit names from `currencyUnitName`:
 *    1500 USD → "US Dollars One Thousand Five Hundred Only",
 *    12.50 USD → "US Dollars Twelve and Fifty Cents Only".
 */
export function amountInWords(
  amount: number | string | null | undefined,
  code: string = DEFAULT_CURRENCY
): string {
  const { name: unit, sub } = currencyUnitName(code);
  const n = Number(amount ?? 0);
  if (Number.isNaN(n) || n <= 0) return `${unit} Zero Only`;

  let whole = Math.floor(n);
  let frac = Math.round((n - whole) * 100);
  if (frac === 100) {
    whole += 1;
    frac = 0;
  }
  const wholeWords = code === "INR"
    ? scaleWords(whole, INDIAN_SCALES)
    : numberToWords(whole);
  const words = frac > 0 ? `${wholeWords} and ${twoDigits(frac)} ${sub}` : wholeWords;
  return `${unit} ${words} Only`;
}

/* --------------------------------- dates ---------------------------------- */

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateLong(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Indian financial year label, e.g. "FY 2025-26". */
export function financialYear(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // Apr(4) starts FY
  const start = m >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Relative timestamp for activity feeds ("just now", "5m ago", "3h ago",
 * "2d ago"), falling back to the short date for anything older.
 * Moved here from @/lib/utils — the single implementation.
 */
export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

/* -------------------------------- misc ------------------------------------ */

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatDuration(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(sec ?? 0)));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}
