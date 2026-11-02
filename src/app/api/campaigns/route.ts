import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET all campaigns
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: Record<string, unknown> = {};
    
    if (status && status !== "all") {
      where.status = status.toUpperCase();
    }

    const campaigns = await db.campaign.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { donations: true },
        },
      },
    });

    const total = await db.campaign.count({ where });

    return NextResponse.json({
      success: true,
      data: campaigns.map(c => ({
        ...c,
        donors: c._count.donations,
      })),
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error fetching campaigns:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch campaigns" },
      { status: 500 }
    );
  }
}

// POST create new campaign
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      title,
      description,
      category = "GENERAL",
      targetAmount,
      startDate,
      endDate,
      location,
      images,
      createdBy,
    } = body;

    const campaign = await db.campaign.create({
      data: {
        title,
        description,
        category: category.toUpperCase(),
        targetAmount: parseFloat(targetAmount),
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        location,
        images: images ? JSON.stringify(images) : null,
        createdBy,
        status: "DRAFT",
      },
    });

    return NextResponse.json({
      success: true,
      data: campaign,
      message: "Campaign created successfully",
    });
  } catch (error) {
    console.error("Error creating campaign:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create campaign" },
      { status: 500 }
    );
  }
}
