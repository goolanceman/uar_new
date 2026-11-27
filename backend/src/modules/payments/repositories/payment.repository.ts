/**
 * Prisma implementation of the payment repository — the ONLY place in the
 * payments module that touches Prisma models directly.
 *
 * Legacy transaction usage is preserved exactly: the payment flows use NO
 * interactive transaction — idempotency comes from the guarded
 * updateMany (WHERE paymentStatus = "PENDING") and every best-effort side
 * effect (campaign totals, broadcast) is swallowed by the service's
 * try/catch, matching the legacy route.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  GatewayOrderData,
  PaymentDonationRow,
  PaymentRepository,
  SettlementData,
} from "./payment.repository.interface";

export class PrismaPaymentRepository implements PaymentRepository {
  async findDonationByReceiptNumber(receiptNumber: string): Promise<PaymentDonationRow | null> {
    return db.donation.findUnique({ where: { receiptNumber } });
  }

  async findDonationByGatewayOrderId(orderId: string): Promise<PaymentDonationRow | null> {
    return db.donation.findFirst({ where: { gatewayOrderId: orderId } });
  }

  async findDonationByIdOrThrow(id: string): Promise<PaymentDonationRow> {
    return db.donation.findUniqueOrThrow({ where: { id } });
  }

  async setGatewayOrder(id: string, data: GatewayOrderData): Promise<void> {
    await mapPrismaError(() => db.donation.update({ where: { id }, data }));
  }

  async settlePendingDonation(id: string, data: SettlementData): Promise<number> {
    const result = await db.donation.updateMany({
      where: { id, paymentStatus: "PENDING" },
      data: {
        paymentStatus: "COMPLETED",
        receiptStatus: "ISSUED",
        receiptIssuedAt: data.receiptIssuedAt,
        ...(data.transactionId ? { transactionId: data.transactionId } : {}),
        paymentProvider: data.paymentProvider,
      },
    });
    return result.count;
  }

  async incrementCampaignRaised(campaignId: string, amount: number): Promise<void> {
    await mapPrismaError(() =>
      db.campaign.update({
        where: { id: campaignId },
        data: { raisedAmount: { increment: amount } },
      })
    );
  }

  async incrementCausePostRaised(causePostId: string, amount: number): Promise<void> {
    await mapPrismaError(() =>
      db.communityPost.update({
        where: { id: causePostId },
        data: { raisedAmount: { increment: amount } },
      })
    );
  }

  async findCampaignTitle(campaignId: string): Promise<{ title: string } | null> {
    return db.campaign.findUnique({
      where: { id: campaignId },
      select: { title: true },
    });
  }

  async markDonationFailed(id: string): Promise<void> {
    await mapPrismaError(() => db.donation.update({ where: { id }, data: { paymentStatus: "FAILED" } }));
  }
}
