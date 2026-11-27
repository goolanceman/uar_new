/**
 * Payment repository contract — donation persistence for gateway order
 * creation, verification settlement, and webhook processing. The service
 * layer depends on this interface, never on Prisma directly.
 */

/** Donation row shape used by the payment flows (plain findUnique/findFirst
 *  rows — full Prisma Donation rows satisfy this subset structurally). */
export interface PaymentDonationRow {
  id: string;
  receiptNumber: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentProvider: string | null;
  transactionId: string | null;
  gatewayOrderId: string | null;
  campaignId: string | null;
  causePostId: string | null;
  donorId: string | null;
  donorName: string;
  donorEmail: string;
  donorPhone: string | null;
  isAnonymous: boolean;
  createdAt: Date;
}

/** Data written onto the donation when a gateway order is stored. */
export interface GatewayOrderData {
  gatewayOrderId: string;
  paymentProvider: string;
}

/** Data written by the guarded PENDING → COMPLETED settlement. */
export interface SettlementData {
  transactionId?: string;
  paymentProvider: string;
  receiptIssuedAt: Date;
}

export interface PaymentRepository {
  findDonationByReceiptNumber(receiptNumber: string): Promise<PaymentDonationRow | null>;
  findDonationByGatewayOrderId(orderId: string): Promise<PaymentDonationRow | null>;
  /** findUniqueOrThrow semantics — the settlement re-read throws (legacy
   *  behavior) if the donation vanished mid-flight. */
  findDonationByIdOrThrow(id: string): Promise<PaymentDonationRow>;
  setGatewayOrder(id: string, data: GatewayOrderData): Promise<void>;

  /**
   * Settles a donation: the only legal transition is PENDING → COMPLETED
   * (guarded in the WHERE clause so concurrent verifications stay idempotent).
   * Maintains the receipt invariant (`receiptStatus == "ISSUED" iff
   * paymentStatus == "COMPLETED"` for gateway donations) atomically.
   * Returns how many rows settled — 0 means another request had already
   * settled it ({ ok, already } replay).
   */
  settlePendingDonation(id: string, data: SettlementData): Promise<number>;

  incrementCampaignRaised(campaignId: string, amount: number): Promise<void>;
  incrementCausePostRaised(causePostId: string, amount: number): Promise<void>;
  /** Title lookup for the live donation broadcast ({title} | null). */
  findCampaignTitle(campaignId: string): Promise<{ title: string } | null>;

  /** Provider-confirmed failure transition (webhook payment.failed). */
  markDonationFailed(id: string): Promise<void>;
}
