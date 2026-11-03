"use client";

/**
 * Shared validation helpers — single source of truth for Indian-format
 * field rules used by admin forms, portals and the public donate flow.
 * Backend routes duplicate these rules; keep both in sync.
 */

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
export const PIN_RE = /^[1-9][0-9]{5}$/;
export const EMAIL_RE = /^\S+@\S+\.\S+$/;
export const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export function validPan(v: string): boolean {
  return PAN_RE.test(v.trim().toUpperCase());
}

export function validPhone(v: string): boolean {
  return PHONE_RE.test(v.replace(/[\s-]/g, ""));
}

export function validPin(v: string): boolean {
  return PIN_RE.test(v.trim());
}

export function validEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function validUpi(v: string): boolean {
  return UPI_RE.test(v.trim());
}

/** Normalize a phone to bare 10 digits (strips +91/spaces/dashes). */
export function normalizePhone(v: string): string {
  return v.replace(/[\s\-+]/g, "").replace(/^91(?=\d{10}$)/, "");
}

export function panToUpperCase(v: string): string {
  return v.trim().toUpperCase();
}

/** "₹1,50,000.00" style INR formatting is in lib/format.ts (formatINR). */

export function fieldError(
  value: unknown,
  rules: Array<(v: unknown) => string | null>
): string | null {
  for (const rule of rules) {
    const err = rule(value);
    if (err) return err;
  }
  return null;
}

// ─── rule factories ──────────────────────────────────────────────────────────

export const required =
  (label = "This field") =>
  (v: unknown): string | null =>
    v === undefined || v === null || String(v).trim() === ""
      ? `${label} is required`
      : null;

export const panRule =
  (optional = false) =>
  (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    if (!s) return optional ? null : "PAN is required for 80G receipts";
    return validPan(s) ? null : "PAN must look like ABCDE1234F";
  };

export const phoneRule =
  (optional = false) =>
  (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    if (!s) return optional ? null : "Mobile number is required";
    return validPhone(s) ? null : "Enter a valid 10-digit Indian mobile number";
  };

export const emailRule =
  (optional = false) =>
  (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    if (!s) return optional ? null : "Email is required";
    return validEmail(s) ? null : "Enter a valid email address";
  };

export const pinRule =
  (optional = false) =>
  (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    if (!s) return optional ? null : "PIN code is required";
    return validPin(s) ? null : "PIN code must be 6 digits (e.g. 560001)";
  };

export const amountRule =
  (opts: { min?: number; max?: number; optional?: boolean; label?: string } = {}) =>
  (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    if (!s) return opts.optional ? null : `${opts.label ?? "Amount"} is required`;
    const n = Number(s);
    if (!Number.isFinite(n)) return "Enter a valid number";
    if (n <= 0) return "Must be greater than zero";
    if (opts.min !== undefined && n < opts.min)
      return `Minimum is ₹${opts.min.toLocaleString("en-IN")}`;
    if (opts.max !== undefined && n > opts.max)
      return `Maximum is ₹${opts.max.toLocaleString("en-IN")}`;
    return null;
  };

export const dateRule =
  (optional = false) =>
  (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    if (!s) return optional ? null : "Date is required";
    return Number.isNaN(new Date(s).getTime()) ? "Enter a valid date" : null;
  };

export const dateRangeRule =
  (startKey: string, endKey: string) =>
  (form: Record<string, unknown>): string | null => {
    const s = form[startKey] ? new Date(String(form[startKey])) : null;
    const e = form[endKey] ? new Date(String(form[endKey])) : null;
    if (s && e && e < s) return "End date must be after the start date";
    return null;
  };

export const minLen =
  (n: number, label = "This field") =>
  (v: unknown): string | null =>
    String(v ?? "").trim().length < n ? `${label} must be at least ${n} characters` : null;
