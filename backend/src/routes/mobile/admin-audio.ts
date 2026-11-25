/**
 * Mobile community ADMIN routes — audio spaces module (full CRUD).
 * Mounted under /api via routes/mobile/index.ts. Auth: mobileAuth (JWT) +
 * ADMIN/MODERATOR role gate — same pattern as the other community/admin modules.
 */
import { Router } from "express";
import { session } from "@/lib/mobile/compat";
import { db } from "@/lib/db";
import {
  mobileAuth,
  data,
  fail,
  ok,
  params,
  str,
  optStr,
  num,
  page,
  feedEvent,
} from "@/lib/mobile/compat";

export const router = Router();

// Shared handler wrapper (same shape as the other admin modules)
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error("[mobile/admin-audio]", e);
    if (!res.headersSent) return fail(res, "Something went wrong");
  });

function requireElevated(req: any, res: any): boolean {
  const role = String(req.session?.role || "");
  if (role !== "ADMIN" && role !== "MODERATOR") {
    res.status(403).json({ status: false, message: "Unauthorized Access", reason: "Admin access required" });
    return false;
  }
  return true;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const SPACE_INCLUDE = {
  participants: { include: { user: true } },
  messages: { include: { user: true }, orderBy: { createdAt: "desc" as const }, take: 50 },
} as const;

function serializeSpace(s: any) {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    topics: s.topics,
    type: s.type,
    is_active: s.isActive,
    ended_at: iso(s.endedAt),
    created_at: iso(s.createdAt),
    updated_at: iso(s.updatedAt),
    hosts: s.participants.filter((p: any) => p.type === "host" || p.type === "admin").map((p: any) => ({
      id: p.user.id,
      username: p.user.username,
      full_name: p.user.name,
      profile: p.user.avatar,
    })),
    listeners: s.participants.filter((p: any) => p.type === "listener").length,
    participants: s.participants.map((p: any) => ({
      id: p.id,
      user_id: p.user.id,
      username: p.user.username,
      full_name: p.user.name,
      profile: p.user.avatar,
      type: p.type,
      mic_status: p.micStatus,
      is_left: p.isLeft,
      joined_at: iso(p.joinedAt),
      left_at: iso(p.leftAt),
    })),
    messages: s.messages.map((m: any) => ({
      id: m.id,
      user_id: m.user.id,
      username: m.user.username,
      full_name: m.user.name,
      profile: m.user.avatar,
      content: m.content,
      created_at: iso(m.createdAt),
    })),
  };
}

// GET /api/community/admin/audio-spaces — paginated list w/ participant counts
router.get("/mobile-admin/audio-spaces", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit } = page(req, 25);
  const q = str(p.q).trim();
  const active = optStr(p.active); // "1" live only, "0" ended only

  const where: any = {};
  if (q) where.OR = [{ title: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }];
  if (active === "1") where.isActive = true;
  if (active === "0") where.isActive = false;

  const [rows, total] = await Promise.all([
    db.audioSpace.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      include: { participants: { include: { user: true } }, messages: { select: { id: true } } },
    }),
    db.audioSpace.count({ where }),
  ]);

  const spaces = rows.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    topics: s.topics,
    type: s.type,
    is_active: s.isActive,
    ended_at: iso(s.endedAt),
    created_at: iso(s.createdAt),
    participant_count: s.participants.length,
    host_count: s.participants.filter((p: any) => p.type === "host" || p.type === "admin").length,
    message_count: s.messages.length,
  }));
  return data(res, "Audio spaces retrieved", { spaces, total_count: total });
}));

// GET /api/community/admin/audio-spaces/details?id= — full detail (participants + messages)
router.get("/mobile-admin/audio-spaces/details", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const id = str(params(req).id);
  const space = await db.audioSpace.findUnique({
    where: { id },
    include: {
      participants: { include: { user: true }, orderBy: { joinedAt: "asc" } },
      messages: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 200 },
    },
  });
  if (!space) return fail(res, "Audio space not found");
  return data(res, "Audio space retrieved", serializeSpace(space));
}));

// POST /api/community/admin/audio-spaces/update — title/description/topics/type/is_active
router.post("/mobile-admin/audio-spaces/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const id = str(b.id);
  const space = await db.audioSpace.findUnique({ where: { id } });
  if (!space) return fail(res, "Audio space not found");

  const patch: any = {};
  const title = optStr(b.title);
  if (title !== null) patch.title = title;
  const description = optStr(b.description);
  if (description !== null) patch.description = description;
  const topics = optStr(b.topics);
  if (topics !== null) patch.topics = topics;
  const type = optStr(b.type);
  if (type === "public" || type === "private") patch.type = type;
  if (b.is_active !== undefined) {
    const active = num(b.is_active, space.isActive ? 1 : 0) === 1;
    patch.isActive = active;
    patch.endedAt = active ? null : (space.endedAt ?? new Date());
  }
  if (Object.keys(patch).length === 0) return fail(res, "Nothing to update");

  const updated = await db.audioSpace.update({ where: { id }, data: patch });
  feedEvent("audio_space.moderated", { id: updated.id, title: updated.title, by: req.session?.name });
  return data(res, "Audio space updated", { id: updated.id, is_active: updated.isActive });
}));

// POST /api/community/admin/audio-spaces/participants/update — role / mic / kick
router.post("/mobile-admin/audio-spaces/participants/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const id = str(b.participant_id);
  const action = str(b.action); // "type" | "mic" | "kick"
  const participant = await db.audioSpaceParticipant.findUnique({ where: { id } });
  if (!participant) return fail(res, "Participant not found");

  if (action === "type") {
    const type = str(b.type);
    const allowed = ["admin", "host", "listener", "requested", "added", "kicked_out"];
    if (!allowed.includes(type)) return fail(res, 'Invalid "type" provided.');
    await db.audioSpaceParticipant.update({ where: { id }, data: { type } });
  } else if (action === "mic") {
    const mic = str(b.mic_status);
    if (mic !== "on" && mic !== "muted") return fail(res, 'Invalid "mic_status" provided.');
    await db.audioSpaceParticipant.update({ where: { id }, data: { micStatus: mic } });
  } else if (action === "kick") {
    await db.audioSpaceParticipant.update({
      where: { id },
      data: { type: "kicked_out", isLeft: true, leftAt: new Date() },
    });
  } else {
    return fail(res, 'Invalid "action" provided.');
  }
  return ok(res, "Participant updated");
}));

// POST /api/community/admin/audio-spaces/delete — cascade (participants + messages)
router.post("/mobile-admin/audio-spaces/delete", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const id = str(params(req).id);
  const space = await db.audioSpace.findUnique({ where: { id } });
  if (!space) return fail(res, "Audio space not found");
  await db.audioSpaceMessage.deleteMany({ where: { audioSpaceId: id } });
  await db.audioSpaceParticipant.deleteMany({ where: { audioSpaceId: id } });
  await db.audioSpace.delete({ where: { id } });
  feedEvent("audio_space.deleted", { id, title: space.title, by: req.session?.name });
  return ok(res, "Audio space deleted successfully");
}));

// POST /api/mobile-admin/audio-spaces/create — schedule an audio space
router.post("/mobile-admin/audio-spaces/create", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const title = str(b.title).trim();
  if (!title) return fail(res, "The title field is required.");
  const type = str(b.type) === "private" ? "private" : "public";

  const space = await db.audioSpace.create({
    data: {
      id: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      description: optStr(b.description),
      topics: optStr(b.topics),
      type,
      isActive: false, // created as scheduled/paused — host starts it live from the app
    },
  });
  if (num(b.host) === 1 || b.host === undefined) {
    await db.audioSpaceParticipant.create({
      data: { audioSpaceId: space.id, userId: session(req).userId, type: "host", micStatus: "on", joinedAt: new Date() },
    });
  }
  feedEvent("audio_space.created", { id: space.id, title, by: session(req).name });
  return data(res, "Audio space created", { id: space.id, title: space.title, type: space.type });
}));
