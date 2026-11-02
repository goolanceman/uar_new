import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET all inventory items
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: Record<string, unknown> = {};
    
    if (category && category !== "all") {
      where.category = category.toUpperCase();
    }

    const items = await db.inventoryItem.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { name: "asc" },
    });

    // Calculate status for each item
    const itemsWithStatus = items.map(item => ({
      ...item,
      status: item.quantity === 0 ? "out_of_stock" : item.quantity < item.minStock ? "low_stock" : "in_stock",
    }));

    // Filter by status if provided
    const filteredItems = status && status !== "all" 
      ? itemsWithStatus.filter(i => i.status === status)
      : itemsWithStatus;

    const total = await db.inventoryItem.count({ where });

    return NextResponse.json({
      success: true,
      data: filteredItems,
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}

// POST create new inventory item
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      name,
      description,
      category = "OTHER",
      unit = "piece",
      quantity = 0,
      minStock = 10,
      pricePerUnit,
      location,
      expiryDate,
    } = body;

    const item = await db.inventoryItem.create({
      data: {
        name,
        description,
        category: category.toUpperCase(),
        unit,
        quantity,
        minStock,
        pricePerUnit: pricePerUnit ? parseFloat(pricePerUnit) : null,
        location,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
      },
    });

    return NextResponse.json({
      success: true,
      data: item,
      message: "Inventory item added successfully",
    });
  } catch (error) {
    console.error("Error creating inventory item:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create inventory item" },
      { status: 500 }
    );
  }
}

// PUT update inventory quantity
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, quantity, operation = "set" } = body;

    const currentItem = await db.inventoryItem.findUnique({
      where: { id },
    });

    if (!currentItem) {
      return NextResponse.json(
        { success: false, error: "Item not found" },
        { status: 404 }
      );
    }

    const newQuantity = operation === "add" 
      ? currentItem.quantity + quantity 
      : operation === "subtract"
      ? Math.max(0, currentItem.quantity - quantity)
      : quantity;

    const item = await db.inventoryItem.update({
      where: { id },
      data: { quantity: newQuantity },
    });

    return NextResponse.json({
      success: true,
      data: item,
      message: "Inventory updated successfully",
    });
  } catch (error) {
    console.error("Error updating inventory:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update inventory" },
      { status: 500 }
    );
  }
}
