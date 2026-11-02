import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    // Get dashboard stats
    const totalDonations = await db.donation.aggregate({
      _sum: { amount: true },
      where: { paymentStatus: "COMPLETED" },
    });

    const beneficiariesCount = await db.beneficiary.count({
      where: { isActive: true },
    });

    const activeCampaigns = await db.campaign.count({
      where: { status: "ACTIVE" },
    });

    const volunteersCount = await db.volunteer.count({
      where: { status: "ACTIVE" },
    });

    const inventoryItems = await db.inventoryItem.aggregate({
      _sum: { quantity: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        totalDonations: totalDonations._sum.amount || 0,
        beneficiaries: beneficiariesCount,
        activeCampaigns,
        volunteers: volunteersCount,
        inventoryItems: inventoryItems._sum.quantity || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}
