/**
 * Community audio-space service — Agora voice rooms (create/join/leave,
 * participant roles, mic state, kick, chat messages). Shared by the generic
 * /api/audio-spaces router (web + mobile).
 *
 * Ported 1:1 from the legacy mobile handlers (AudioSpaceController.php via
 * src/routes/mobile/chat-audio.ts): client-supplied space/message ids,
 * admin/host/listener roles, kicked_out + leaved_users bookkeeping, and the
 * any-participant-row access checks.
 */
import { db } from "@/infrastructure/database/prisma";
import { ApiError } from "@/infrastructure/auth/session";
import { feedEvent } from "@/domains/community/push";

// ─── Lookups ──────────────────────────────────────────────────────────────────

/** AudioSpace::find — soft-delete aware. */
export function findSpace(id: string) {
  return db.audioSpace.findFirst({ where: { id, deletedAt: null } });
}

/** AudioSpace::getParticipant — any participant row regardless of is_left. */
export function getSpaceParticipant(spaceId: string, userId: string) {
  return db.audioSpaceParticipant.findFirst({ where: { audioSpaceId: spaceId, userId } });
}

export const PARTICIPANT_TYPES = ["admin", "host", "listener", "requested", "added", "kicked_out"];
export const MIC_STATUSES = ["on", "muted"];

/** String field from a users[] entry — camelCase primary, legacy snake_case
 *  fallback (pre-migration callers still post {mic_status, is_left}). */
function participantField(u: Record<string, unknown>, camel: string, snake: string): string | null {
  const v = u[camel] ?? u[snake];
  return typeof v === "string" && v ? v : null;
}

function participantBool(u: Record<string, unknown>, camel: string, snake: string): boolean {
  const v = u[camel] ?? u[snake];
  return v === true || v === 1 || v === "1" || v === "true";
}

// ─── Serialization (camelCase) ───────────────────────────────────────────────

type ParticipantRow = {
  type: string;
  micStatus: string;
  isLeft: boolean;
  joinedAt: Date | null;
  createdAt: Date;
  user: {
    id: string;
    name: string | null;
    username: string | null;
    avatar: string | null;
    deviceToken: string | null;
    deviceType: number;
  };
};

/** Participant wire shape — deviceToken/deviceType kept (legacy exposed them;
 *  the app uses them for speak-request pushes). */
function audioUserWire(p: ParticipantRow) {
  return {
    id: p.user.id,
    fullName: p.user.name,
    username: p.user.username,
    image: p.user.avatar,
    deviceToken: p.user.deviceToken ?? "",
    deviceType: p.user.deviceType ?? 0,
    type: p.type,
    micStatus: p.micStatus,
    createdAt: (p.joinedAt ?? p.createdAt).toISOString(),
  };
}

type SpaceRow = {
  id: string;
  title: string | null;
  description: string | null;
  topics: string | null;
  type: string;
  agoraToken: string | null;
  createdAt: Date;
};

/** Space wire shape (getAudioSpaces / getAudioSpace / create). */
function spaceWire(
  space: SpaceRow,
  participants: ParticipantRow[]
) {
  return {
    id: space.id,
    title: space.title,
    description: space.description,
    topics: space.topics,
    type: space.type,
    token: space.agoraToken ?? "",
    createdAt: space.createdAt.toISOString(),
    users: participants.filter((p) => !p.isLeft).map(audioUserWire),
    leavedUsers: participants.filter((p) => p.isLeft).map(audioUserWire),
  };
}

async function participantsOf(spaceId: string) {
  return db.audioSpaceParticipant.findMany({
    where: { audioSpaceId: spaceId },
    include: { user: true },
  });
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** GET /audio-spaces — AudioSpaceController::getAudioSpaces. */
export async function listAudioSpaces(me: string) {
  const spaces = await db.audioSpace.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      OR: [{ type: "public" }, { participants: { some: { userId: me } } }],
    },
    include: { participants: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
  });
  return spaces.map((s) => spaceWire(s, s.participants));
}

/** GET /audio-spaces/:id — AudioSpaceController::getAudioSpace. */
export async function getAudioSpace(me: string, id: string) {
  const space = await findSpace(id);
  if (!space) throw new ApiError("Audio space not found", 404);

  const participants = await participantsOf(space.id);
  if (space.type === "private" && !participants.some((p) => p.userId === me)) {
    throw new ApiError("Access denied", 403);
  }
  return spaceWire(space, participants);
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * POST /audio-spaces — AudioSpaceController::createAudioSpace. The client
 * supplies the space id (UUID) — the Agora channel is named after it — plus
 * the initial participants ({users: [{id, type, micStatus}]}).
 */
export async function createAudioSpace(
  me: string,
  input: {
    id?: string | null;
    title?: string | null;
    description?: string | null;
    topics?: string | null;
    type?: string | null;
    agoraToken?: string | null;
    users?: unknown;
  }
) {
  const id = input.id ?? null;
  if (!id) throw new ApiError("The id field is required", 400);
  if (id.length > 100) throw new ApiError("The id may not be greater than 100 characters", 400);
  if (await db.audioSpace.findUnique({ where: { id }, select: { id: true } })) {
    throw new ApiError("The id has already been taken", 409);
  }

  const type = String(input.type ?? "").toLowerCase();
  if (type !== "public" && type !== "private") throw new ApiError("The selected type is invalid", 400);

  const agoraToken = input.agoraToken ?? null;
  if (agoraToken && agoraToken.length > 512) {
    throw new ApiError("The agora token may not be greater than 512 characters", 400);
  }

  if (!Array.isArray(input.users) || input.users.length === 0) {
    throw new ApiError("The users field is required", 400);
  }
  const usersData = input.users as Array<Record<string, unknown>>;

  // Bad participant ids would fail the FK — reject up front (legacy 500 path).
  for (const u of usersData) {
    const uid = typeof u?.id === "string" ? u.id : null;
    if (!uid) throw new ApiError("Failed to create audio space", 400);
    const exists = await db.user.findUnique({ where: { id: uid }, select: { id: true } });
    if (!exists) throw new ApiError("Failed to create audio space", 400);
  }

  const space = await db.audioSpace.create({
    data: {
      id,
      title: input.title ?? null,
      description: input.description ?? null,
      topics: input.topics ?? null,
      type,
      agoraToken,
      isActive: true,
    },
  });

  const users: Array<Record<string, unknown>> = [];
  for (const u of usersData) {
    const participant = await db.audioSpaceParticipant.create({
      data: {
        audioSpaceId: space.id,
        userId: String(u.id),
        type: participantField(u, "type", "type") ?? "listener",
        micStatus: participantField(u, "micStatus", "mic_status") ?? "muted",
        isLeft: false,
        joinedAt: new Date(),
      },
      include: { user: true },
    });
    users.push(audioUserWire(participant));
  }

  feedEvent("audio_space.created", { id: space.id, type: space.type });

  return { ...spaceWire(space, []), users, leavedUsers: [] };
}

/**
 * PATCH /audio-spaces/:id — AudioSpaceController::updateAudioSpace (admin
 * only). Upserts the participants ({users: [{id, type, micStatus, isLeft}]}).
 */
export async function updateAudioSpace(
  me: string,
  id: string,
  input: { users?: unknown }
) {
  const space = await findSpace(id);
  if (!space) throw new ApiError("Audio space not found", 404);

  const myParticipant = await getSpaceParticipant(space.id, me);
  if (!myParticipant || myParticipant.type !== "admin") {
    throw new ApiError("Only admins can update the audio space", 403);
  }

  if (!Array.isArray(input.users) || input.users.length === 0) {
    throw new ApiError("The users field is required", 400);
  }
  const usersData = input.users as Array<Record<string, unknown>>;

  for (const u of usersData) {
    const uid = typeof u?.id === "string" ? u.id : null;
    if (!uid) throw new ApiError("Failed to update audio space", 400);
    const type = participantField(u, "type", "type");
    const micStatus = participantField(u, "micStatus", "mic_status");
    const participant = await getSpaceParticipant(space.id, uid);
    if (participant) {
      const isLeft = u.isLeft === undefined && u.is_left === undefined ? participant.isLeft : participantBool(u, "isLeft", "is_left");
      await db.audioSpaceParticipant.update({
        where: { id: participant.id },
        data: {
          type: type ?? participant.type,
          micStatus: micStatus ?? participant.micStatus,
          isLeft,
          ...(isLeft ? { leftAt: new Date() } : {}),
        },
      });
    } else {
      const isLeft = participantBool(u, "isLeft", "is_left");
      await db.audioSpaceParticipant.create({
        data: {
          audioSpaceId: space.id,
          userId: uid,
          type: type ?? "listener",
          micStatus: micStatus ?? "muted",
          isLeft,
          joinedAt: new Date(),
          ...(isLeft ? { leftAt: new Date() } : {}),
        },
      });
    }
  }

  return { ok: true };
}

/** DELETE /audio-spaces/:id — AudioSpaceController::deleteAudioSpace (admin
 *  only; AudioSpace::endSpace() + soft delete). */
export async function deleteAudioSpace(me: string, id: string) {
  const space = await findSpace(id);
  if (!space) throw new ApiError("Audio space not found", 404);

  const myParticipant = await getSpaceParticipant(space.id, me);
  if (!myParticipant || myParticipant.type !== "admin") {
    throw new ApiError("Only admins can end the audio space", 403);
  }

  await db.audioSpace.update({
    where: { id: space.id },
    data: { isActive: false, endedAt: new Date(), deletedAt: new Date() },
  });
  return { ok: true };
}

/** POST /audio-spaces/:id/join — AudioSpaceController::joinAudioSpace. */
export async function joinAudioSpace(me: string, id: string) {
  const space = await findSpace(id);
  if (!space || !space.isActive) throw new ApiError("Audio space not found or inactive", 404);

  const participant = await getSpaceParticipant(space.id, me);
  if (participant && !participant.isLeft) return { ok: true, joined: false }; // already in

  if (participant) {
    // Rejoin.
    await db.audioSpaceParticipant.update({
      where: { id: participant.id },
      data: { isLeft: false, leftAt: null, joinedAt: new Date() },
    });
  } else {
    await db.audioSpaceParticipant.create({
      data: {
        audioSpaceId: space.id,
        userId: me,
        type: "listener",
        micStatus: "muted",
        isLeft: false,
        joinedAt: new Date(),
      },
    });
  }
  return { ok: true, joined: true };
}

/** POST /audio-spaces/:id/leave — AudioSpaceController::leaveAudioSpace. */
export async function leaveAudioSpace(me: string, id: string) {
  const space = await findSpace(id);
  if (!space) throw new ApiError("Audio space not found", 404);

  const participant = await getSpaceParticipant(space.id, me);
  if (!participant || participant.isLeft) throw new ApiError("You are not in this audio space", 400);

  // AudioSpaceParticipant::leave()
  await db.audioSpaceParticipant.update({
    where: { id: participant.id },
    data: { isLeft: true, leftAt: new Date() },
  });
  return { ok: true };
}

/** POST /audio-spaces/:id/participants/:userId/role — changeParticipantType. */
export async function changeParticipantRole(
  me: string,
  spaceId: string,
  userId: string,
  rawType: unknown
) {
  const type = String(rawType ?? "").toLowerCase();
  if (!type) throw new ApiError("The type field is required", 400);
  if (!PARTICIPANT_TYPES.includes(type)) throw new ApiError("The selected type is invalid", 400);

  const space = await findSpace(spaceId);
  if (!space) throw new ApiError("Audio space not found", 404);

  const myParticipant = await getSpaceParticipant(space.id, me);
  if (!myParticipant || myParticipant.type !== "admin") {
    throw new ApiError("Only admins can change participant types", 403);
  }

  const participant = await getSpaceParticipant(space.id, userId);
  if (!participant) throw new ApiError("User is not in this audio space", 404);

  await db.audioSpaceParticipant.update({ where: { id: participant.id }, data: { type } });
  return { ok: true, type };
}

/** POST /audio-spaces/:id/participants/:userId/mic — toggleParticipantMic. */
export async function toggleParticipantMic(
  me: string,
  spaceId: string,
  userId: string,
  rawMicStatus: unknown
) {
  const micStatus = String(rawMicStatus ?? "").toLowerCase();
  if (!micStatus) throw new ApiError("The micStatus field is required", 400);
  if (!MIC_STATUSES.includes(micStatus)) throw new ApiError("The selected mic status is invalid", 400);

  const space = await findSpace(spaceId);
  if (!space) throw new ApiError("Audio space not found", 404);

  const participant = await getSpaceParticipant(space.id, userId);
  if (!participant) throw new ApiError("User is not in this audio space", 404);

  // Self or admin only.
  if (userId !== me) {
    const myParticipant = await getSpaceParticipant(space.id, me);
    if (!myParticipant || myParticipant.type !== "admin") {
      throw new ApiError("Only admins can toggle other users' mics", 403);
    }
  }

  await db.audioSpaceParticipant.update({
    where: { id: participant.id },
    data: { micStatus },
  });
  return { ok: true, micStatus };
}

/** POST /audio-spaces/:id/participants/:userId/kick — kickParticipant. */
export async function kickParticipant(me: string, spaceId: string, userId: string) {
  const space = await findSpace(spaceId);
  if (!space) throw new ApiError("Audio space not found", 404);

  const myParticipant = await getSpaceParticipant(space.id, me);
  if (!myParticipant || myParticipant.type !== "admin") {
    throw new ApiError("Only admins can kick participants", 403);
  }

  const participant = await getSpaceParticipant(space.id, userId);
  if (!participant) throw new ApiError("User is not in this audio space", 404);

  // changeType('kicked_out') + leave().
  await db.audioSpaceParticipant.update({
    where: { id: participant.id },
    data: { type: "kicked_out", isLeft: true, leftAt: new Date() },
  });
  return { ok: true };
}

/** GET /audio-spaces/:id/messages — AudioSpaceController::getMessages. */
export async function getAudioSpaceMessages(me: string, spaceId: string, limit: number) {
  const space = await findSpace(spaceId);
  if (!space) throw new ApiError("Audio space not found", 404);

  // hasParticipant: any participant row, even one that left.
  if (!(await getSpaceParticipant(space.id, me))) throw new ApiError("Access denied", 403);

  const rows = await db.audioSpaceMessage.findMany({
    where: { audioSpaceId: space.id },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  rows.reverse(); // legacy: ->get()->reverse()->values() (oldest first)

  return rows.map((m) => ({
    id: m.id,
    content: m.content,
    userId: m.userId,
    user: {
      id: m.user.id,
      fullName: m.user.name,
      username: m.user.username,
      image: m.user.avatar,
    },
    time: m.createdAt.toISOString(),
  }));
}

/** POST /audio-spaces/:id/messages — AudioSpaceController::sendMessage
 *  (client-supplied message id; persistence only, like the legacy). */
export async function sendAudioSpaceMessage(
  me: string,
  spaceId: string,
  input: { id?: string | null; content?: string | null }
) {
  const id = input.id ?? null;
  if (!id) throw new ApiError("The id field is required", 400);
  if (id.length > 100) throw new ApiError("The id may not be greater than 100 characters", 400);
  if (await db.audioSpaceMessage.findUnique({ where: { id }, select: { id: true } })) {
    throw new ApiError("The id has already been taken", 409);
  }
  const content = input.content ?? "";
  if (!content) throw new ApiError("The content field is required", 400);

  const space = await findSpace(spaceId);
  if (!space || !space.isActive) throw new ApiError("Audio space not found or inactive", 404);

  const participant = await getSpaceParticipant(space.id, me);
  if (!participant || participant.isLeft) throw new ApiError("You are not in this audio space", 403);

  const message = await db.audioSpaceMessage.create({
    data: { id, audioSpaceId: space.id, userId: me, content },
  });

  // The legacy controller only persisted — no websocket broadcast here.
  feedEvent("audio_space.message", { space_id: space.id, user_id: me });

  const meUser = await db.user.findUnique({ where: { id: me } });
  return {
    id: message.id,
    content: message.content,
    userId: me,
    user: {
      id: me,
      fullName: meUser?.name ?? null,
      username: meUser?.username ?? null,
      image: meUser?.avatar ?? null,
    },
    time: message.createdAt.toISOString(),
  };
}
