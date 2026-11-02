import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET all beneficiaries
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const urgency = searchParams.get("urgency");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: Record<string, unknown> = {};
    
    if (category && category !== "all") {
      where.category = category.toUpperCase();
    }
    if (urgency && urgency !== "all") {
      where.urgencyLevel = urgency.toUpperCase();
    }
    if (status && status !== "all") {
      where.isActive = status === "active";
    }

    const beneficiaries = await db.beneficiary.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { distributions: true },
        },
      },
    });

    const total = await db.beneficiary.count({ where });

    return NextResponse.json({
      success: true,
      data: beneficiaries.map(b => ({
        ...b,
        distributionsCount: b._count.distributions,
      })),
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error fetching beneficiaries:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch beneficiaries" },
      { status: 500 }
    );
  }
}

// POST create new beneficiary
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      name,
      phone,
      email,
      address,
      city,
      state,
      pincode,
      category = "OTHER",
      urgencyLevel = "MEDIUM",
      familyMembers = 1,
      monthlyIncome,
      needs,
      documents,
      notes,
    } = body;

    const beneficiary = await db.beneficiary.create({
      data: {
        name,
        phone,
        email,
        address,
        city,
        state,
        pincode,
        category: category.toUpperCase(),
        urgencyLevel: urgencyLevel.toUpperCase(),
        familyMembers,
        monthlyIncome: monthlyIncome ? parseFloat(monthlyIncome) : null,
        needs: needs ? JSON.stringify(needs) : null,
        documents: documents ? JSON.stringify(documents) : null,
        notes,
      },
    });

    return NextResponse.json({
      success: true,
      data: beneficiary,
      message: "Beneficiary registered successfully",
    });
  } catch (error) {
    console.error("Error creating beneficiary:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create beneficiary" },
      { status: 500 }
    );
  }
}
