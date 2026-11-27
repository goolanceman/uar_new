/**
 * Donor repository contract — persistence for the donor CRM. The service
 * layer depends on this interface, never on Prisma directly.
 */
import type { Certificate, Donor, Prisma } from "@prisma/client";

/** List row — donor with the portal-account link the UI renders. */
export type DonorWithUser = Prisma.DonorGetPayload<{
  include: { user: { select: { id: true; role: true; status: true } } };
}>;

/** Donor-360 row — profile with the richer user select (adds city). */
export type DonorWithUserCity = Prisma.DonorGetPayload<{
  include: { user: { select: { id: true; role: true; status: true; city: true } } };
}>;

export type DonorDonationRow = Prisma.DonationGetPayload<{
  include: { campaign: { select: { title: true; accent: true } } };
}>;

export type DonorPledgeRow = Prisma.PledgeGetPayload<{
  include: { cause: { select: { code: true; patientName: true } } };
}>;

export type DonorAnimalPledgeRow = Prisma.AnimalPledgeGetPayload<{
  include: { animal: { select: { name: true; species: true } } };
}>;

/** Single donation.groupBy row (lifetime value + counts per donor email). */
export interface DonorAggregateRow {
  donorEmail: string;
  _sum: { amount: number | null };
  _count: { id: number };
  _max: { createdAt: Date | null };
  _min: { createdAt: Date | null };
}

export interface DonorListFilter {
  q?: string;
  type?: string;
  category?: string;
}

export interface CreateDonorData {
  code: string;
  type: string;
  organizationName: string | null;
  name: string;
  email: string;
  phone: string | null;
  altPhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  pan: string | null;
  language: string | null;
  source: string;
  category: string | null;
  wants80g: boolean;
  anonymousByDefault: boolean;
  emailOptIn: boolean;
  smsOptIn: boolean;
  whatsappOptIn: boolean;
  tags: string | null;
  notes: string | null;
  userId: string | null;
}

/** PATCH data — field order is preserved by the service for the audit logs.
 *  Nullable fields match the legacy PATCH assignments (they may be cleared). */
export interface UpdateDonorData {
  name?: string;
  type?: string;
  organizationName?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  pan?: string | null;
  language?: string | null;
  source?: string | null;
  category?: string | null;
  wants80g?: boolean;
  anonymousByDefault?: boolean;
  emailOptIn?: boolean;
  smsOptIn?: boolean;
  whatsappOptIn?: boolean;
  tags?: string | null;
  notes?: string | null;
}

export interface DonorRepository {
  /** Paged CRM list, newest update first, with the user select. */
  list(filter: DonorListFilter, skip: number, take: number): Promise<{ rows: DonorWithUser[]; total: number }>;
  /** Lifetime value + counts per donor email (COMPLETED donations only). */
  aggregateByEmails(emails: string[]): Promise<DonorAggregateRow[]>;
  findByEmail(email: string): Promise<Donor | null>;
  /** Portal account with the same email — linked on create (userId). */
  findUserIdByEmail(email: string): Promise<{ id: string } | null>;
  create(data: CreateDonorData): Promise<Donor>;

  findById(id: string): Promise<DonorWithUserCity | null>;
  /** Plain existence lookup for PATCH/DELETE (no includes). */
  findSimpleById(id: string): Promise<Donor | null>;
  update(id: string, data: UpdateDonorData): Promise<Donor>;
  /** Unlinks donations (donorRefId → null); legacy ran it before the delete. */
  clearDonationLinks(donorRefId: string): Promise<number>;
  remove(id: string): Promise<void>;

  listDonationsByEmail(email: string): Promise<DonorDonationRow[]>;
  /** Legacy passes donor.userId ?? undefined — undefined means NO donorId filter. */
  listPledgesByUserId(userId: string | undefined): Promise<DonorPledgeRow[]>;
  listAnimalPledgesByUserId(userId: string | undefined): Promise<DonorAnimalPledgeRow[]>;
  listCertificatesByEmail(email: string): Promise<Certificate[]>;
}
