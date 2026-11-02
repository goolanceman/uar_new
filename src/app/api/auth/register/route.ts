import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, phone, password, role = "DONOR" } = body;

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: "Email already registered" },
        { status: 400 }
      );
    }

    // Create user
    // In production, hash the password!
    const user = await db.user.create({
      data: {
        name,
        email,
        phone,
        password, // TODO: Hash in production!
        role: role.toUpperCase() as "ADMIN" | "VOLUNTEER" | "DONOR" | "BENEFICIARY",
      },
    });

    // Create activity log
    await db.activityLog.create({
      data: {
        userId: user.id,
        action: "REGISTER",
        entityType: "USER",
        entityId: user.id,
      },
    });

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json({
      success: true,
      data: userWithoutPassword,
      message: "Registration successful",
    });
  } catch (error) {
    console.error("Error during registration:", error);
    return NextResponse.json(
      { success: false, error: "Registration failed" },
      { status: 500 }
    );
  }
}
