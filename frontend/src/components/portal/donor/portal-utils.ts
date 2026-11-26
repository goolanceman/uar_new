"use client";

/**
 * Donor-portal shared helpers — FY windows, 80G eligibility maths and
 * response-shape shims used across every donor view. Kept local to the
 * donor folder so beneficiary/admin modules stay independent.
 */

import { financialYear } from "@/lib/format";
import { post } from "@/lib/api-client";

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

/* ------------------ gateway checkout for installments --------------------- */

/** POST /api/payments payload — public fields only (Razorpay key id is public). */
interface GatewayOrder {
  provider: string;
  orderId?: string;
  keyId?: string;
  amount?: number;
  currency?: string;
  checkoutUrl?: string;
  paymentSessionId?: string;
}

type RzpInstance = { open: () => void };
type RzpWindow = {
  Razorpay?: new (options: {
    key: string;
    order_id: string;
    amount: number;
    currency: string;
    name: string;
    description?: string;
    prefill?: { name?: string; email?: string; contact?: string };
    theme?: { color?: string };
    modal?: { ondismiss?: () => void };
    handler: (r: {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    }) => void | Promise<void>;
  }) => RzpInstance;
};

/** Loads the Razorpay hosted-checkout SDK once per page session. */
export async function loadRazorpayCheckout(): Promise<boolean> {
  const w = window as unknown as RzpWindow;
  if (w.Razorpay) return true;
  return new Promise((resolve) => {
    const el = document.createElement("script");
    el.src = "https://checkout.razorpay.com/v1/checkout.js";
    el.async = true;
    el.onload = () => resolve(Boolean((window as unknown as RzpWindow).Razorpay));
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
  });
}

export type InstallmentPayResult = { ok: true } | { ok: false; error: string; redirectToDonate?: boolean };

/**
 * Pays a PENDING donation through the normal gateway flow — the SAME pipeline
 * the public Donate page uses: POST /api/payments creates the provider order
 * against the receipt number, Razorpay hosted checkout opens in the portal,
 * and the signed callback is verified via POST /api/payments/verify. Other
 * providers are answered honestly (the Donate page owns those checkouts).
 */
export async function payPendingDonation(opts: {
  receiptNumber: string;
  description: string;
  name?: string;
  email?: string;
  contact?: string;
}): Promise<InstallmentPayResult> {
  try {
    const order = await post<GatewayOrder>("/api/payments", { receiptNumber: opts.receiptNumber });
    if (order.provider !== "RAZORPAY") {
      return {
        ok: false,
        error: `This gateway (${order.provider}) is supported on the Donate page — please complete the payment there.`,
        redirectToDonate: true,
      };
    }
    const loaded = await loadRazorpayCheckout();
    const w = window as unknown as RzpWindow;
    if (!loaded || !w.Razorpay)
      return { ok: false, error: "Razorpay checkout could not be loaded — check your connection and try again." };

    return await new Promise<InstallmentPayResult>((resolve) => {
      const rzp = new w.Razorpay!({
        key: order.keyId ?? "",
        order_id: order.orderId ?? "",
        amount: order.amount ?? 0,
        currency: order.currency ?? "INR",
        name: "United Angel Reach",
        description: opts.description,
        prefill: { name: opts.name, email: opts.email, contact: opts.contact },
        theme: { color: "#059669" },
        modal: {
          ondismiss: () => resolve({ ok: false, error: "Payment window closed — press Pay again to retry." }),
        },
        handler: async (r) => {
          try {
            await post("/api/payments/verify", {
              razorpay_order_id: r.razorpay_order_id,
              razorpay_payment_id: r.razorpay_payment_id,
              razorpay_signature: r.razorpay_signature,
            });
            resolve({ ok: true });
          } catch (e) {
            resolve({
              ok: false,
              error: e instanceof Error ? e.message : "Payment verification failed — our team will reconcile your receipt.",
            });
          }
        },
      });
      rzp.open();
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not start the payment." };
  }
}
