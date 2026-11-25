/**
 * Beneficiary case workflow — single source of truth for the two parallel
 * machines on a beneficiary record.
 *
 * caseStatus:   INTAKE → VERIFICATION → ACTIVE → CLOSED, rejection while
 *               still open · CLOSED/REJECTED terminal.
 * verification: PENDING → DOCUMENTS_REQUESTED → VERIFIED, rejection before
 *               verification · VERIFIED/REJECTED terminal.
 *
 * Consumed by PATCH /api/beneficiaries/:id (transition guards) and the admin
 * beneficiaries view (filter chips + form dropdowns).
 */

export const CASE_STATUSES = [
  "INTAKE",
  "VERIFICATION",
  "ACTIVE",
  "CLOSED",
  "REJECTED",
] as const;

export const CASE_STATUS_TRANSITIONS: Record<string, string[]> = {
  INTAKE: ["VERIFICATION", "CLOSED", "REJECTED"],
  VERIFICATION: ["ACTIVE", "CLOSED", "REJECTED"],
  ACTIVE: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
};

export const VERIFICATION_STATUSES = [
  "PENDING",
  "DOCUMENTS_REQUESTED",
  "VERIFIED",
  "REJECTED",
] as const;

export const VERIFICATION_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["DOCUMENTS_REQUESTED", "VERIFIED", "REJECTED"],
  DOCUMENTS_REQUESTED: ["VERIFIED", "REJECTED"],
  VERIFIED: [],
  REJECTED: [],
};
