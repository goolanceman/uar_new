import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET all volunteers
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: Record<string, unknown> = {};
    
    if (status && status !== "all") {
      where.status = status.toUpperCase();
    }

    const volunteers = await db.volunteer.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { name: true, email: true, phone: true },
        },
        _count: {
          select: { tasks: true },
        },
      },
    });

    const total = await db.volunteer.count({ where });

    return NextResponse.json({
      success: true,
      data: volunteers.map(v => ({
        ...v,
        tasksCompleted: v._count.tasks,
      })),
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error fetching volunteers:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch volunteers" },
      { status: 500 }
    );
  }
}

// POST register new volunteer
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      name,
      email,
      phone,
      password,
      skills,
      availability,
      assignedArea,
      emergencyContact,
      idProof,
    } = body;

    // Create user first
    const user = await db.user.create({
      data: {
        name,
        email,
        phone,
        password, // In production, hash this!
        role: "VOLUNTEER",
      },
    });

    // Create volunteer profile
    const volunteer = await db.volunteer.create({
      data: {
        userId: user.id,
        skills: skills ? JSON.stringify(skills) : null,
        availability: availability ? JSON.stringify(availability) : null,
        assignedArea,
        emergencyContact,
        idProof,
        status: "PENDING",
      },
    });

    return NextResponse.json({
      success: true,
      data: { user, volunteer },
      message: "Volunteer registered successfully",
    });
  } catch (error) {
    console.error("Error creating volunteer:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create volunteer" },
      { status: 500 }
    );
  }
}
