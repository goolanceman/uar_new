import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET all donations
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: Record<string, unknown> = {};
    
    if (category && category !== "all") {
      where.category = category.toUpperCase();
    }
    if (status && status !== "all") {
      where.paymentStatus = status.toUpperCase();
    }

    const donations = await db.donation.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      include: {
        donor: {
          select: { name: true, email: true },
        },
        campaign: {
          select: { title: true },
        },
      },
    });

    const total = await db.donation.count({ where });

    return NextResponse.json({
      success: true,
      data: donations,
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error fetching donations:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch donations" },
      { status: 500 }
    );
  }
}

// POST create new donation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      donorId,
      donorName,
      donorEmail,
      donorPhone,
      amount,
      type = "ONE_TIME",
      category = "GENERAL",
      paymentMethod = "UPI",
      campaignId,
      message,
      isAnonymous = false,
    } = body;

    // Generate receipt number
    const receiptNumber = `UAR-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const donation = await db.donation.create({
      data: {
        donorId,
        donorName,
        donorEmail,
        donorPhone,
        amount: parseFloat(amount),
        type: type.toUpperCase(),
        category: category.toUpperCase(),
        paymentMethod: paymentMethod.toUpperCase(),
        receiptNumber,
        campaignId,
        message,
        isAnonymous,
        paymentStatus: "PENDING",
      },
    });

    // Create activity log
    await db.activityLog.create({
      data: {
        userId: donorId,
        action: "DONATION_CREATED",
        entityType: "DONATION",
        entityId: donation.id,
        details: JSON.stringify({ amount: donation.amount, category: donation.category }),
      },
    });

    return NextResponse.json({
      success: true,
      data: donation,
      message: "Donation recorded successfully",
    });
  } catch (error) {
    console.error("Error creating donation:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create donation" },
      { status: 500 }
    );
  }
}
