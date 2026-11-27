/**
 * Donation settlement side effects — the card/points/achievement half of the
 * legacy mobile settleDonation (compat charity.ts), extracted so EVERY
 * settlement path (web verify, Razorpay webhook, admin transitions) awards
 * the donor through one shared function. Called from settleCompleted() in
 * routes/payments.ts.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendPush, feedEvent } from "@/lib/community/push";
import { syncCardStats } from "@/lib/charity/card";
import { evaluateAchievements } from "@/lib/charity/achievements";

const log = logger.child("settlement");

/** DonationPoint::awardDonationPoints — ₹1 = 2 points, expire after 1 year. */
export async function awardDonationPoints(userId: string, donationId: string, amount: number): Promise<void> {
  const points = Math.trunc(amount * 2);
  await db.donationPoint.create({
    data: {
      userId,
      donationId,
      points,
      type: "earned",
      description: `Earned from donation of ₹${amount.toFixed(2)}`,
      expiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    },
  });
}

/**
 * Donor rewards for a settled donation: points row + charity card sync +
 * achievement evaluation + donor push + SSE feed event. Never throws —
 * rewards must never break settlement (callers still log the failure).
 */
export async function settleDonationSideEffects(donation: {
  id: string;
  donorId: string | null | undefined;
  amount: number;
  campaignId: string | null | undefined;
}): Promise<void> {
  if (!donation.donorId) return;
  try {
    await awardDonationPoints(donation.donorId, donation.id, donation.amount);
    await syncCardStats(donation.donorId);
    await evaluateAchievements(donation.donorId);
    await sendPush({
      userId: donation.donorId,
      title: "Donation successful",
      body: `Thank you for your contribution of ₹${donation.amount.toFixed(2)}!`,
      type: "DONATION",
      data: { donationId: donation.id, amount: donation.amount },
    });
    feedEvent("donation.verified", {
      donationId: donation.id,
      amount: donation.amount,
      campaignId: donation.campaignId,
      userId: donation.donorId,
    });
  } catch (e) {
    log.error("settlement_side_effects_failed", { error: e, donationId: donation.id, donorId: donation.donorId });
  }
}
