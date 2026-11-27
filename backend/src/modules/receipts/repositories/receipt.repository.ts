/**
 * Prisma implementation of the receipt repository — the ONLY place in the
 * receipts module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import type {
  ReceiptDateRange,
  ReceiptDetailRow,
  ReceiptDonationRow,
  ReceiptHtmlRow,
  ReceiptListScope,
  ReceiptRepository,
} from "./receipt.repository.interface";

export class PrismaReceiptRepository implements ReceiptRepository {
  async listDonations(
    scope: ReceiptListScope,
    range: ReceiptDateRange,
    limit: number
  ): Promise<ReceiptDonationRow[]> {
    const where: Record<string, unknown> = { paymentStatus: "COMPLETED" };

    if (scope.ownOnly) {
      // Donors (and volunteers viewing their own giving) see only their rows.
      where.OR = [{ donorId: scope.userId }, { donorEmail: scope.email }];
    }

    if (range.gte || range.lte) where.createdAt = range;

    return db.donation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { campaign: { select: { title: true } } },
    });
  }

  async findByReceiptNumber(receiptNumber: string): Promise<ReceiptDetailRow | null> {
    return db.donation.findUnique({
      where: { receiptNumber },
      include: {
        campaign: { select: { title: true, slug: true } },
        donor: { select: { pan: true, phone: true, name: true } },
      },
    });
  }

  async findForHtml(receiptNumber: string): Promise<ReceiptHtmlRow | null> {
    return db.donation.findUnique({
      where: { receiptNumber },
      include: {
        campaign: { select: { title: true } },
        donor: { select: { pan: true, phone: true } },
      },
    });
  }
}
