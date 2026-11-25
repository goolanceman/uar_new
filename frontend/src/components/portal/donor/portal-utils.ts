"use client";

/**
 * Donor-portal shared helpers — FY windows, 80G eligibility maths and
 * response-shape shims used across every donor view. Kept local to the
 * donor folder so beneficiary/admin modules stay independent.
 */

import { financialYear } from "@/lib/format";

export function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data as T[];
    if (Array.isArray(rec.items)) return rec.items as T[];
    if (Array.isArray(rec.notifications)) return rec.notifications as T[];
    if (Array.isArray(rec.certificates)) return rec.certificates as T[];
    if (Array.isArray(rec.pledges)) return rec.pledges as T[];
  }
  return [];
}

/* ------------------------------ FY helpers ------------------------------- */

/** FY start year for a date — Indian FY runs April → March. */
export function fyStartYear(d: Date = new Date()): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export function fyLabel(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function fyRange(startYear: number): { from: string; to: string } {
  return {
    from: new Date(startYear, 3, 1).toISOString(),
    to: new Date(startYear + 1, 2, 31, 23, 59, 59).toISOString(),
  };
}

export function fyTimestamps(startYear: number): { start: number; end: number } {
  return {
    start: new Date(startYear, 3, 1).getTime(),
    end: new Date(startYear + 1, 2, 31, 23, 59, 59).getTime(),
  };
}

export function currentFyLabel(): string {
  return financialYear(new Date());
}

const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

/** Twelve monthly buckets (Apr → Mar) for the giving-trend chart. */
export function fyMonthBuckets(
  startYear: number,
  donations: Array<{ amount: number; createdAt: string; paymentStatus?: string | null }>
): Array<{ month: string; amount: number; count: number }> {
  const { start, end } = fyTimestamps(startYear);
  const buckets = MONTHS.map((month) => ({ month, amount: 0, count: 0 }));
  for (const d of donations) {
    const t = new Date(d.createdAt).getTime();
    if (Number.isNaN(t) || t < start || t > end) continue;
    if (d.paymentStatus && d.paymentStatus !== "COMPLETED") continue;
    const date = new Date(d.createdAt);
    const idx = date.getMonth() >= 3 ? date.getMonth() - 3 : date.getMonth() + 9;
    buckets[idx].amount += Number(d.amount) || 0;
    buckets[idx].count += 1;
  }
  return buckets;
}

/* --------------------------- 80G eligibility ----------------------------- */

/**
 * 80G rule of thumb for UAR receipts:
 *  · only COMPLETED payments earn a receipt
 *  · cash gifts above ₹2,000 are recorded but NOT tax-eligible (Sec 80G(5))
 */
export function is80gEligible(d: {
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  amount?: number | null;
}): boolean {
  if ((d.paymentStatus ?? "").toUpperCase() !== "COMPLETED") return false;
  if ((d.paymentMethod ?? "").toUpperCase() === "CASH" && (Number(d.amount) || 0) > 2000)
    return false;
  return true;
}

/** 50% of the 80G-eligible amount — the indicative ITR deduction. */
export function estimateDeduction(donations: Array<{ paymentStatus?: string | null; paymentMethod?: string | null; amount?: number | null }>): number {
  return Math.round(
    donations
      .filter(is80gEligible)
      .reduce((s, d) => s + (Number(d.amount) || 0), 0) * 0.5
  );
}

/* ---------------------------- print openers ------------------------------ */

export function openReceipt(receiptNumber: string): void {
  window.open(`/api/receipts/${encodeURIComponent(receiptNumber)}/html`, "_blank", "noopener");
}

export function openCertificate(code: string): void {
  window.open(`/api/certificates/${encodeURIComponent(code)}/html`, "_blank", "noopener");
}
