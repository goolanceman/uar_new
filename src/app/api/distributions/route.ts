import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET all distributions
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: Record<string, unknown> = {};
    
    if (type && type !== "all") {
      where.type = type.toUpperCase();
    }

    const distributions = await db.distribution.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { distributedAt: "desc" },
      include: {
        beneficiary: {
          select: { name: true, category: true },
        },
        volunteer: {
          include: {
            user: {
              select: { name: true },
            },
          },
        },
      },
    });

    const total = await db.distribution.count({ where });

    return NextResponse.json({
      success: true,
      data: distributions,
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error fetching distributions:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch distributions" },
      { status: 500 }
    );
  }
}

// POST create new distribution
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      type,
      beneficiaryId,
      volunteerId,
      campaignId,
      items,
      quantity = 1,
      value,
      location,
      latitude,
      longitude,
      photos,
      notes,
      distributedAt,
    } = body;

    const distribution = await db.distribution.create({
      data: {
        type: type.toUpperCase(),
        beneficiaryId,
        volunteerId,
        campaignId,
        items: items ? JSON.stringify(items) : null,
        quantity,
        value: value ? parseFloat(value) : null,
        location,
        latitude,
        longitude,
        photos: photos ? JSON.stringify(photos) : null,
        notes,
        distributedAt: distributedAt ? new Date(distributedAt) : new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      data: distribution,
      message: "Distribution recorded successfully",
    });
  } catch (error) {
    console.error("Error creating distribution:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create distribution" },
      { status: 500 }
    );
  }
}
