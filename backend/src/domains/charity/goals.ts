/**
 * Donation goals domain logic — port of the legacy DonationGoalsController
 * (mobile compat): list, create, update, delete, complete, summary.
 */
import type { DonationGoal } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { ApiError } from "@/infrastructure/auth/session";

const GOAL_FREQUENCIES = ["one_time", "monthly", "yearly"] as const;
const GOAL_STATUSES = ["active", "completed", "cancelled", "expired"] as const;

function dateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** camelCase goal wire (deadline kept — the Dart model reads it). */
export function goalWire(g: DonationGoal) {
  const progress = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
  return {
    id: g.id,
    userId: g.userId,
    title: g.title,
    description: g.description,
    targetAmount: g.targetAmount,
    currentAmount: g.currentAmount,
    deadline: dateOnly(g.endDate),
    endDate: dateOnly(g.endDate),
    startDate: dateOnly(g.startDate),
    frequency: g.frequency,
    status: g.status,
    isPublic: g.isPublic,
    completedAt: g.completedAt ? g.completedAt.toISOString() : null,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
    progressPercentage: Math.round(progress * 100) / 100,
    remainingAmount: Math.max(0, g.targetAmount - g.currentAmount),
    isAchieved: g.currentAmount >= g.targetAmount,
  };
}

export function goalStatusWhere(userId: string, status: string): Record<string, unknown> {
  let where: Record<string, unknown> = { userId };
  if (status === "active") where = { ...where, status: "active" };
  else if (status === "completed") where = { ...where, status: "completed" };
  else if (status === "expired") where = { ...where, status: "active", endDate: { lt: new Date() } };
  return where;
}

export async function listGoals(userId: string, status: string) {
  const goals = await db.donationGoal.findMany({
    where: goalStatusWhere(userId, status),
    orderBy: { createdAt: "desc" },
  });
  return goals;
}

export async function getGoal(userId: string, goalId: string) {
  const goal = await db.donationGoal.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw new ApiError("Goal not found or access denied", 404);
  return goal;
}

export async function createGoal(
  userId: string,
  input: {
    title: string;
    targetAmount: number;
    deadline?: string | null;
    endDate?: string | null;
    description?: string | null;
    startDate?: string | null;
    frequency?: string | null;
    isPublic?: boolean;
  }
) {
  const title = input.title.trim();
  if (!title) throw new ApiError("Goal title is required", 400);
  if (!(input.targetAmount >= 1) || input.targetAmount > 99999999.99) {
    throw new ApiError("The target amount must be between 1 and 99999999.99.", 400);
  }

  // the app sends `deadline`; the legacy validator read `end_date`
  const endRaw = input.endDate ?? input.deadline;
  if (!endRaw) throw new ApiError("Goal deadline is required", 400);
  const endDate = new Date(endRaw);
  if (Number.isNaN(endDate.getTime())) throw new ApiError("The end date must be a valid date.", 400);

  const startDateRaw = input.startDate;
  const startDate =
    startDateRaw && !Number.isNaN(new Date(startDateRaw).getTime()) ? new Date(startDateRaw) : new Date();
  const frequency = input.frequency || "one_time";
  if (!GOAL_FREQUENCIES.includes(frequency as (typeof GOAL_FREQUENCIES)[number])) {
    throw new ApiError("Invalid frequency", 400);
  }

  const goal = await db.donationGoal.create({
    data: {
      userId,
      title,
      description: input.description ?? null,
      targetAmount: input.targetAmount,
      currentAmount: 0,
      startDate,
      endDate,
      frequency,
      status: "active",
      isPublic: input.isPublic ?? false,
    },
  });
  return goalWire(goal);
}

export async function updateGoal(
  userId: string,
  goalId: string,
  input: {
    title?: string;
    description?: string | null;
    targetAmount?: number;
    deadline?: string | null;
    isPublic?: boolean;
    status?: string;
  }
) {
  const goal = await getGoal(userId, goalId);
  if (goal.status === "completed") throw new ApiError("Cannot update completed goal", 400);

  const dataToUpdate: Record<string, unknown> = {};
  if (input.title !== undefined && input.title !== null) {
    const t = input.title.trim();
    if (!t) throw new ApiError("Goal title cannot be empty", 400);
    dataToUpdate.title = t;
  }
  if (input.description !== undefined) dataToUpdate.description = input.description;
  if (input.targetAmount !== undefined && input.targetAmount !== null) {
    if (input.targetAmount < 1) throw new ApiError("The target amount must be at least 1.", 400);
    dataToUpdate.targetAmount = input.targetAmount;
  }
  if (input.deadline) {
    const d = new Date(input.deadline);
    if (Number.isNaN(d.getTime())) throw new ApiError("The end date must be a valid date.", 400);
    dataToUpdate.endDate = d;
  }
  if (input.isPublic !== undefined) dataToUpdate.isPublic = input.isPublic;
  if (input.status && GOAL_STATUSES.includes(input.status as (typeof GOAL_STATUSES)[number])) {
    dataToUpdate.status = input.status;
  }

  if (Object.keys(dataToUpdate).length === 0) throw new ApiError("Nothing to update", 400);
  const updated = await db.donationGoal.update({ where: { id: goal.id }, data: dataToUpdate });
  return goalWire(updated);
}

export async function deleteGoal(userId: string, goalId: string) {
  const goal = await getGoal(userId, goalId);
  await db.donationGoal.delete({ where: { id: goal.id } });
  return { ok: true };
}

export async function completeGoal(userId: string, goalId: string) {
  const goal = await getGoal(userId, goalId);
  if (goal.status === "completed") throw new ApiError("Goal already completed", 400);
  const updated = await db.donationGoal.update({
    where: { id: goal.id },
    data: { status: "completed", completedAt: new Date() },
  });
  return goalWire(updated);
}

export async function goalsSummary(userId: string) {
  const goals = await db.donationGoal.findMany({ where: { userId } });
  const active = goals.filter((g) => g.status === "active");
  const in7d = new Date(Date.now() + 7 * 864e5);
  return {
    totalGoals: goals.length,
    activeGoals: active.length,
    completedGoals: goals.filter((g) => g.status === "completed").length,
    goalsNearCompletion: active.filter((g) => {
      const pct = g.targetAmount > 0 ? (g.currentAmount / g.targetAmount) * 100 : 0;
      return pct >= 75;
    }).length,
    upcomingDeadlines: active.filter((g) => g.endDate.getTime() <= in7d.getTime()).length,
  };
}
