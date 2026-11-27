/**
 * Audio-space repository contract — the shared community audio-space domain
 * (create/join/leave, participant roles, mic state, kick, chat messages).
 * The service layer depends on this interface, never on Prisma or the lib
 * directly.
 */

/** Participant wire shape — deviceToken/deviceType kept (legacy exposed
 *  them; the app uses them for speak-request pushes). */
export interface AudioParticipantWire {
  id: string;
  fullName: string | null;
  username: string | null;
  image: string | null;
  deviceToken: string;
  deviceType: number;
  type: string;
  micStatus: string;
  createdAt: string;
}

/** Space wire shape (list / get / create). */
export interface AudioSpaceWire {
  id: string;
  title: string | null;
  description: string | null;
  topics: string | null;
  type: string;
  token: string;
  createdAt: string;
  users: AudioParticipantWire[];
  leavedUsers: AudioParticipantWire[];
}

export interface AudioMessageWire {
  id: string;
  content: string;
  userId: string;
  user: { id: string; fullName: string | null; username: string | null; image: string | null };
  time: string;
}

export interface AudioSpaceListPayload {
  items: AudioSpaceWire[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface AudioMessageListPayload {
  items: AudioMessageWire[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface JoinResult {
  ok: boolean;
  joined: boolean;
}

export interface RoleResult {
  ok: boolean;
  type: string;
}

export interface MicResult {
  ok: boolean;
  micStatus: string;
}

export interface OkResult {
  ok: boolean;
}

export interface AudioSpaceRepository {
  list(userId: string): Promise<AudioSpaceWire[]>;
  get(userId: string, id: string): Promise<AudioSpaceWire>;
  create(userId: string, body: Record<string, unknown>): Promise<AudioSpaceWire>;
  update(userId: string, spaceId: string, users: unknown): Promise<OkResult>;
  end(userId: string, spaceId: string): Promise<OkResult>;
  join(userId: string, spaceId: string): Promise<JoinResult>;
  leave(userId: string, spaceId: string): Promise<OkResult>;
  changeRole(userId: string, spaceId: string, participantId: string, type: unknown): Promise<RoleResult>;
  toggleMic(userId: string, spaceId: string, participantId: string, micStatus: unknown): Promise<MicResult>;
  kick(userId: string, spaceId: string, participantId: string): Promise<OkResult>;
  messages(userId: string, spaceId: string, limit: number): Promise<AudioMessageWire[]>;
  sendMessage(userId: string, spaceId: string, body: Record<string, unknown>): Promise<AudioMessageWire>;
}
