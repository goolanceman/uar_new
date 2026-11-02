import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET all pad distributions
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const distributions = await db.padDistribution.findMany({
      take: limit,
      skip: offset,
      orderBy: { distributionDate: "desc" },
      include: {
        beneficiary: {
          select: { name: true, location: true },
        },
      },
    });

    const total = await db.padDistribution.count();

    // Get monthly stats
    const monthlyStats = await db.padDistribution.groupBy({
      by: ['distributionDate'],
      _sum: {
        girlsCount: true,
        padsDistributed: true,
      },
      _count: true,
    });

    // Get total counts
    const totals = await db.padDistribution.aggregate({
      _sum: {
        girlsCount: true,
        padsDistributed: true,
      },
      _count: {
        awarenessSession: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: distributions,
      stats: {
        totalGirls: totals._sum.girlsCount || 0,
        totalPads: totals._sum.padsDistributed || 0,
        awarenessSessions: totals._count.awarenessSession || 0,
      },
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error fetching pad distributions:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch pad distributions" },
      { status: 500 }
    );
  }
}

// POST create new pad distribution
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      beneficiaryId,
      schoolName,
      area,
      girlsCount,
      padsDistributed,
      awarenessSession = false,
      sessionAttendees,
      volunteerId,
      distributionDate,
      notes,
    } = body;

    const distribution = await db.padDistribution.create({
      data: {
        beneficiaryId,
        schoolName,
        area,
        girlsCount: parseInt(girlsCount),
        padsDistributed: parseInt(padsDistributed),
        awarenessSession,
        sessionAttendees: sessionAttendees ? parseInt(sessionAttendees) : null,
        volunteerId,
        distributionDate: distributionDate ? new Date(distributionDate) : new Date(),
        notes,
      },
    });

    return NextResponse.json({
      success: true,
      data: distribution,
      message: "Pad distribution recorded successfully",
    });
  } catch (error) {
    console.error("Error creating pad distribution:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create pad distribution" },
      { status: 500 }
    );
  }
}
