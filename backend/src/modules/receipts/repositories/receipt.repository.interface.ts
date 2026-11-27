/**
 * Receipt repository contract — persistence operations for 80G donation
 * receipts. The service layer depends on this interface, never on Prisma
 * directly.
 */
import type { Prisma } from "@prisma/client";

/** Row shape of the receipt list (legacy include on GET /). */
export type ReceiptDonationRow = Prisma.DonationGetPayload<{
  include: { campaign: { select: { title: true } } };
}>;

/** Row shape of the receipt detail (legacy include on GET /:receiptNumber). */
export type ReceiptDetailRow = Prisma.DonationGetPayload<{
  include: {
    campaign: { select: { title: true; slug: true } };
    donor: { select: { pan: true; phone: true; name: true } };
  };
}>;

/** Row shape of the print-ready HTML receipt (legacy include on /html). */
export type ReceiptHtmlRow = Prisma.DonationGetPayload<{
  include: {
    campaign: { select: { title: true } };
    donor: { select: { pan: true; phone: true } };
  };
}>;

/** Who the list is scoped to — ADMIN sees every completed donation, other
 *  signed-in roles only their own (donorId OR donorEmail). */
export interface ReceiptListScope {
  ownOnly: boolean;
  userId: string;
  email: string;
}

/** createdAt range derived from the ?from&to query params (invalid dates were
 *  silently ignored by the legacy handler). */
export interface ReceiptDateRange {
  gte?: Date;
  lte?: Date;
}

export interface ReceiptRepository {
  listDonations(scope: ReceiptListScope, range: ReceiptDateRange, limit: number): Promise<ReceiptDonationRow[]>;
  findByReceiptNumber(receiptNumber: string): Promise<ReceiptDetailRow | null>;
  findForHtml(receiptNumber: string): Promise<ReceiptHtmlRow | null>;
}
