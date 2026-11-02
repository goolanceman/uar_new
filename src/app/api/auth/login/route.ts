import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Find user by email
    const user = await db.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // In production, compare hashed passwords!
    if (user.password !== password) {
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { success: false, error: "Account is deactivated" },
        { status: 403 }
      );
    }

    // Create activity log
    await db.activityLog.create({
      data: {
        userId: user.id,
        action: "LOGIN",
        entityType: "USER",
        entityId: user.id,
      },
    });

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json({
      success: true,
      data: userWithoutPassword,
      message: "Login successful",
    });
  } catch (error) {
    console.error("Error during login:", error);
    return NextResponse.json(
      { success: false, error: "Login failed" },
      { status: 500 }
    );
  }
}
