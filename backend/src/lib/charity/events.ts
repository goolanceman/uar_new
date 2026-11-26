/**
 * Charity events domain logic — port of the legacy CharityEventsController
 * (mobile compat): list, mine, details, register, cancel, QR check-in.
 */
import { createHash } from "node:crypto";
import type { CharityEvent } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/session";
import { feedEvent } from "@/lib/community/push";

export const EVENT_TYPES = ["fundraiser", "volunteer", "workshop", "awareness", "community"] as const;
export const EVENT_STATUSES = ["upcoming", "ongoing", "completed", "cancelled"] as const;

/** camelCase event wire with the per-user registration state folded in. */
export function eventWire(
  e: CharityEvent,
  opts?: { isRegistered?: boolean; registrationStatus?: string | null; qrCode?: string | null; registeredAt?: Date | null }
) {
  const now = new Date();
  const max = e.maxParticipants;
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    type: e.type,
    location: e.location,
    startDatetime: e.startDatetime.toISOString(),
    endDatetime: e.endDatetime.toISOString(),
    maxParticipants: max ?? 0,
    currentParticipants: e.currentParticipants,
    status: e.status,
    requiresRegistration: e.requiresRegistration,
    requiresQrCheckin: e.requiresQrCheckin,
    pointsReward: e.pointsReward,
    imageUrl: e.imageUrl,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    isFull: max !== null && max > 0 ? e.currentParticipants >= max : false,
    hasStarted: e.startDatetime.getTime() <= now.getTime(),
    hasEnded: e.endDatetime.getTime() <= now.getTime(),
    availableSpots: max === null ? null : Math.max(0, max - e.currentParticipants),
    isRegistered: opts?.isRegistered ?? false,
    registrationStatus: opts?.registrationStatus ?? null,
    qrCode: opts?.qrCode ?? null,
    registeredAt: opts?.registeredAt ? opts.registeredAt.toISOString() : null,
  };
}

/** GET /events — list with per-user registration enrichment (optional auth). */
export async function listEvents(userId: string | null, filters: { type?: string | null; status?: string | null }) {
  const type = filters.type;
  if (type && !EVENT_TYPES.includes(type as (typeof EVENT_TYPES)[number])) {
    throw new ApiError("Invalid event type", 400);
  }
  const status = filters.status?.toLowerCase();
  if (status && !EVENT_STATUSES.includes(status as (typeof EVENT_STATUSES)[number])) {
    throw new ApiError("Invalid event status", 400);
  }

  const now = new Date();
  let where: Record<string, unknown> = { ...(type ? { type } : {}) };
  if (status === "upcoming") where = { ...where, status: "upcoming", startDatetime: { gt: now } };
  else if (status === "ongoing") where = { ...where, status: "ongoing" };
  else if (status) where = { ...where, status };

  const rows = await db.charityEvent.findMany({ where, orderBy: { startDatetime: "asc" } });
  const registrations = userId
    ? await db.eventParticipant.findMany({ where: { userId, eventId: { in: rows.map((r) => r.id) } } })
    : [];
  const byEvent = new Map(registrations.map((r) => [r.eventId, r]));

  return rows.map((e) => {
    const reg = byEvent.get(e.id);
    return eventWire(e, {
      isRegistered: !!reg,
      registrationStatus: reg?.status ?? null,
      qrCode: reg?.qrCode ?? null,
      registeredAt: reg?.registeredAt ?? null,
    });
  });
}

/** GET /events/mine — the signed-in user's registrations. */
export async function myEvents(userId: string, status: string) {
  const where = { userId, ...(status !== "all" ? { status } : {}) };
  const rows = await db.eventParticipant.findMany({
    where,
    orderBy: { registeredAt: "desc" },
    include: { event: true },
  });
  // Flattened event wire + registration fields so the app's event list model
  // can parse both the event and the participation state.
  return rows.map((r) => ({
    ...eventWire(r.event),
    registrationStatus: r.status,
    qrCode: r.qrCode,
    registeredAt: r.registeredAt.toISOString(),
    checkedInAt: r.checkedInAt ? r.checkedInAt.toISOString() : null,
    isRegistered: r.status !== "cancelled",
  }));
}

/** GET /events/:id — details + participants (public read, per-user state). */
export async function eventDetails(eventId: string, userId: string | null) {
  const event = await db.charityEvent.findUnique({
    where: { id: eventId },
    include: { participants: { include: { user: true } } },
  });
  if (!event) throw new ApiError("Event not found", 404);

  const mine = userId ? event.participants.find((pt) => pt.userId === userId) : undefined;

  return {
    ...eventWire(event, {
      isRegistered: !!mine,
      registrationStatus: mine?.status ?? null,
      qrCode: mine?.qrCode ?? null,
      registeredAt: mine?.registeredAt ?? null,
    }),
    participants: event.participants.map((pt) => ({
      id: pt.id,
      eventId: pt.eventId,
      userId: pt.userId,
      status: pt.status,
      registeredAt: pt.registeredAt.toISOString(),
      checkedInAt: pt.checkedInAt ? pt.checkedInAt.toISOString() : null,
      qrCode: pt.qrCode,
      user: {
        id: pt.user.id,
        name: pt.user.name,
        username: pt.user.username ?? "",
        avatar: pt.user.avatar,
      },
    })),
  };
}

/** POST /events/:id/register — capacity-checked, idempotent-rejected. */
export async function registerForEvent(userId: string, eventId: string, notes?: string | null) {
  const event = await db.charityEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new ApiError("Event not found", 404);
  if (event.maxParticipants !== null && event.currentParticipants >= event.maxParticipants) {
    throw new ApiError("Event is full", 400);
  }

  const existing = await db.eventParticipant.findUnique({
    where: { eventId_userId: { eventId: event.id, userId } },
  });
  if (existing) throw new ApiError("Already registered for this event", 400);

  const qrCode = createHash("md5").update(`${event.id}-${userId}-${Date.now()}`).digest("hex");
  const participant = await db.eventParticipant.create({
    data: {
      eventId: event.id,
      userId,
      status: "registered",
      registeredAt: new Date(),
      qrCode,
      notes: notes ?? null,
    },
  });
  await db.charityEvent.update({
    where: { id: event.id },
    data: { currentParticipants: { increment: 1 } },
  });

  feedEvent("event.registered", { eventId: event.id, userId });
  return {
    participant: {
      id: participant.id,
      eventId: participant.eventId,
      userId: participant.userId,
      status: participant.status,
      registeredAt: participant.registeredAt.toISOString(),
      checkedInAt: participant.checkedInAt ? participant.checkedInAt.toISOString() : null,
      qrCode: participant.qrCode,
      notes: participant.notes,
    },
    qrCode: participant.qrCode,
  };
}

/** POST /events/:id/cancel — not after attending / start. */
export async function cancelRegistration(userId: string, eventId: string) {
  const participant = await db.eventParticipant.findUnique({
    where: { eventId_userId: { eventId, userId } },
    include: { event: true },
  });
  if (!participant) throw new ApiError("Not registered for this event", 404);
  if (participant.status === "attended") throw new ApiError("Cannot cancel after attending", 400);
  if (participant.event.startDatetime.getTime() <= Date.now()) {
    throw new ApiError("Cannot cancel after event has started", 400);
  }

  await db.eventParticipant.update({ where: { id: participant.id }, data: { status: "cancelled" } });
  await db.charityEvent.update({
    where: { id: participant.event.id },
    data: { currentParticipants: { decrement: 1 } },
  });
  return { ok: true };
}

/** POST /events/check-in — QR check-in; awards the event's points once. */
export async function checkIn(userId: string, eventId: string, qrCode?: string | null) {
  const participant = await db.eventParticipant.findUnique({
    where: { eventId_userId: { eventId, userId } },
    include: { event: true },
  });
  if (!participant) throw new ApiError("Not registered for this event", 404);

  if (participant.event.requiresQrCheckin && qrCode) {
    if (participant.qrCode !== qrCode) throw new ApiError("Invalid QR code", 400);
  }
  if (participant.status === "attended") throw new ApiError("Already checked in", 400);

  const updated = await db.eventParticipant.update({
    where: { id: participant.id },
    data: { status: "attended", checkedInAt: new Date() },
  });

  // EventParticipant::checkIn — award the event's points once
  let pointsEarned = 0;
  if (!participant.pointsAwarded && participant.event.pointsReward > 0) {
    pointsEarned = participant.event.pointsReward;
    await db.donationPoint.create({
      data: {
        userId,
        donationId: null,
        points: pointsEarned,
        type: "earned",
        description: `Attended event: ${participant.event.title}`,
      },
    });
    await db.eventParticipant.update({ where: { id: participant.id }, data: { pointsAwarded: true } });
    await db.charityCard.update({
      where: { userId },
      data: { donationPoints: { increment: pointsEarned } },
    }).catch(() => undefined);
    await db.user.update({
      where: { id: userId },
      data: { totalPoints: { increment: pointsEarned } },
    });
  }

  feedEvent("event.checked_in", { eventId, userId });
  return {
    participant: {
      id: updated.id,
      eventId: updated.eventId,
      userId: updated.userId,
      status: updated.status,
      registeredAt: updated.registeredAt.toISOString(),
      checkedInAt: updated.checkedInAt ? updated.checkedInAt.toISOString() : null,
      qrCode: updated.qrCode,
    },
    pointsEarned,
  };
}
