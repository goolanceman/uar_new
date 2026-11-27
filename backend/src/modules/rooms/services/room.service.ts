/**
 * Room service — the thin coordination layer over the shared community rooms
 * domain (@/domains/community/rooms): applies the legacy silent body coercions,
 * pages results, and emits the route-level domain events with their exact
 * legacy names (the lib layer logs its own events under "community:rooms").
 * Depends on the repository contract, throws application errors, never
 * touches HTTP.
 */
import { logger } from "@/infrastructure/logging/logger";
import type { Session } from "@/infrastructure/auth/session";
import { paged } from "@/domains/community/serializers";
import { csvValue, type EditRoomPatch } from "@/domains/community/rooms";
import type { RoomRepository } from "../repositories/room.repository.interface";
import type {
  DefaultPageQuery,
  InvitableUsersQuery,
  OwnRoomsQuery,
  RandomRoomsQuery,
  RoomBody,
} from "../schemas/room.schema";

const log = logger.child("rooms");

/** Legacy silent numeric coercion: undefined/null/"" → undefined, else the
 *  finite Number() or undefined. */
function numParam(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export class RoomService {
  constructor(private readonly roomRepository: RoomRepository) {}

  /** GET /api/rooms/mine — rooms I own (legacy fetchMyOwnRooms). */
  async mine(session: Session, query: OwnRoomsQuery) {
    const { rows, total } = await this.roomRepository.listOwnRooms(session.userId, (query.page - 1) * query.limit, query.limit);
    return paged(rows, query.page, query.limit, total);
  }

  /** GET /api/rooms/joined — memberships (2|3|5) with the room (legacy fetchRoomsList). */
  async joined(session: Session, query: OwnRoomsQuery) {
    const { rows, total } = await this.roomRepository.listJoinedRooms(session.userId, (query.page - 1) * query.limit, query.limit);
    return paged(rows, query.page, query.limit, total);
  }

  /** GET /api/rooms/memberships — every room_users row of mine (legacy fetchRoomsIAmIn). */
  async memberships(session: Session, query: OwnRoomsQuery) {
    const { rows, total } = await this.roomRepository.listMemberships(session.userId, (query.page - 1) * query.limit, query.limit);
    return paged(rows, query.page, query.limit, total);
  }

  /** GET /api/rooms/suggested — up to 2 public rooms I'm not in, preferring my
   *  interests (legacy getSuggestedRooms / fetchSuggestedRooms — also feeds the
   *  posts router). */
  async suggested(session: Session) {
    const user = await this.roomRepository.me(session.userId);
    const items = await this.roomRepository.getSuggestedRooms(user);
    return paged(items, 1, 2, items.length);
  }

  /** GET /api/rooms/random — random public rooms (legacy fetchRandomRooms). */
  async random(session: Session, query: RandomRoomsQuery) {
    const items = await this.roomRepository.listRandomRooms(session.userId, query.limit);
    return paged(items, 1, query.limit, items.length);
  }

  /** GET /api/rooms/invitations — my pending invitations (legacy getInvitationList). */
  async invitations(session: Session, query: DefaultPageQuery) {
    const { rows, total } = await this.roomRepository.listInvitations(session.userId, (query.page - 1) * query.limit, query.limit);
    return paged(rows, query.page, query.limit, total);
  }

  /** GET /api/rooms/by-interest/:interestId — public, non-full rooms for an interest
   *  (legacy fetchRoomsByInterest). */
  async byInterest(session: Session, interestId: string, query: DefaultPageQuery) {
    const { rows, total } = await this.roomRepository.listRoomsByInterest(session.userId, interestId, (query.page - 1) * query.limit, query.limit);
    return paged(rows, query.page, query.limit, total);
  }

  /** POST /api/rooms — create a room (multipart photo; legacy createRoom). */
  async create(session: Session, body: RoomBody, photoUrl: string | null) {
    const room = await this.roomRepository.createRoom(session, {
      title: String(body.title ?? ""),
      desc: String(body.desc ?? ""),
      interestIds: csvValue(body.interestIds),
      isPrivate: numParam(body.isPrivate) ?? 0,
      isJoinRequestEnable: numParam(body.isJoinRequestEnable) ?? 0,
    }, photoUrl);
    log.info("room_created", {
      roomId: room.id,
      title: room.title,
      isPrivate: room.isPrivate,
      actor: session.userId,
    });
    return room;
  }

  /** GET /api/rooms/:id — detail + auto conversation (+ members with ?showMembers=1). */
  async detail(session: Session, roomId: string, showMembers: boolean) {
    return this.roomRepository.roomDetail(session.userId, roomId, showMembers);
  }

  /** PATCH /api/rooms/:id — edit (multipart photo; legacy editRoom). */
  async update(session: Session, roomId: string, body: RoomBody, photoUrl: string | null) {
    const patch: EditRoomPatch = {};
    if (body.title !== undefined) patch.title = String(body.title ?? "");
    if (body.desc !== undefined) patch.desc = String(body.desc ?? "");
    if (body.interestIds !== undefined) patch.interestIds = csvValue(body.interestIds);
    if (body.isPrivate !== undefined) patch.isPrivate = numParam(body.isPrivate) ?? 0;
    if (body.isJoinRequestEnable !== undefined) patch.isJoinRequestEnable = numParam(body.isJoinRequestEnable) ?? 0;
    const room = await this.roomRepository.editRoom(session, roomId, patch, photoUrl);
    log.info("room_updated", {
      roomId,
      actor: session.userId,
      fields: Object.entries(patch).filter(([, v]) => v !== undefined).map(([k]) => k),
      ...(photoUrl ? { photoUpdated: true } : {}),
    });
    return room;
  }

  /** DELETE /api/rooms/:id — room admin OR moderator (legacy deleteRoom +
   *  Moderator/deleteRoomByModerator). */
  async remove(session: Session, roomId: string) {
    const room = await this.roomRepository.deleteRoom(session, roomId);
    log.info("room_deleted", { roomId: room.id, actor: session.userId });
    return room;
  }

  /** POST /api/rooms/:id/join — join request or direct join (legacy joinOrRequestRoom). */
  async join(session: Session, roomId: string) {
    const member = await this.roomRepository.joinRoom(session, roomId);
    log.info("room_joined", { roomId: member.roomId, actor: session.userId, memberType: member.type });
    return member;
  }

  /** POST /api/rooms/:id/leave — leave (legacy leaveThisRoom). */
  async leave(session: Session, roomId: string) {
    const member = await this.roomRepository.leaveRoom(session, roomId);
    log.info("room_left", { roomId: member.roomId, actor: session.userId });
    return member;
  }

  /** POST /api/rooms/:id/report — { reason, desc } (legacy reportRoom). */
  async report(session: Session, roomId: string, body: RoomBody) {
    const report = await this.roomRepository.reportRoom(session, roomId, String(body.reason ?? ""), String(body.desc ?? ""));
    log.info("room_reported", { roomId: report.roomId, reportId: report.id, actor: session.userId });
    return report;
  }

  /** POST /api/rooms/:id/mute — { isMute? } set or toggle (legacy muteUnmuteRoomNotification). */
  async mute(session: Session, roomId: string, body: RoomBody) {
    const member = await this.roomRepository.setMute(session, roomId, numParam(body.isMute));
    log.info("room_mute_set", { roomId: member.roomId, actor: session.userId, isMute: member.isMute });
    return member;
  }

  /** POST /api/rooms/:id/invitations — { userId } invite (legacy inviteUserToRoom). */
  async invite(session: Session, roomId: string, body: RoomBody) {
    const member = await this.roomRepository.inviteUser(session, roomId, String(body.userId ?? ""));
    log.info("room_invited", { roomId: member.roomId, invitedUserId: member.userId, actor: session.userId });
    return member;
  }

  /** POST /api/rooms/:id/invitations/accept — my invitation (legacy acceptInvitation). */
  async acceptInvitation(session: Session, roomId: string) {
    const member = await this.roomRepository.acceptInvitation(session, roomId);
    log.info("room_invitation_accepted", { roomId: member.roomId, actor: session.userId });
    return member;
  }

  /** POST /api/rooms/:id/invitations/reject — my invitation (legacy rejectInvitation). */
  async rejectInvitation(session: Session, roomId: string) {
    const member = await this.roomRepository.rejectInvitation(session, roomId);
    log.info("room_invitation_rejected", { roomId: member.roomId, actor: session.userId });
    return member;
  }

  /** GET /api/rooms/:id/invitable-users?q= — invite picker (legacy searchUserForInvitation). */
  async invitableUsers(session: Session, roomId: string, q: unknown, query: InvitableUsersQuery) {
    const { rows, total } = await this.roomRepository.invitableUsers(session, roomId, String(q ?? ""), (query.page - 1) * query.limit, query.limit);
    return paged(rows, query.page, query.limit, total);
  }

  /** GET /api/rooms/:id/requests — pending join requests (legacy fetchRoomRequestList). */
  async requests(session: Session, roomId: string, query: DefaultPageQuery) {
    const { rows, total } = await this.roomRepository.listRequests(session, roomId, (query.page - 1) * query.limit, query.limit);
    return paged(rows, query.page, query.limit, total);
  }

  /** POST /api/rooms/:id/requests/:userId/accept (legacy acceptRoomRequest). */
  async acceptRequest(session: Session, roomId: string, userId: string) {
    const member = await this.roomRepository.acceptRequest(session, roomId, userId);
    log.info("room_request_accepted", { roomId: member.roomId, memberId: member.userId, actor: session.userId });
    return member;
  }

  /** POST /api/rooms/:id/requests/:userId/reject (legacy rejectRoomRequest). */
  async rejectRequest(session: Session, roomId: string, userId: string) {
    const member = await this.roomRepository.rejectRequest(session, roomId, userId);
    log.info("room_request_rejected", { roomId: member.roomId, memberId: member.userId, actor: session.userId });
    return member;
  }

  /** GET /api/rooms/:id/members — member list (legacy fetchRoomUsersList). */
  async members(roomId: string, query: DefaultPageQuery) {
    const { rows, total } = await this.roomRepository.listMembers(roomId, (query.page - 1) * query.limit, query.limit);
    return paged(rows, query.page, query.limit, total);
  }

  /** DELETE /api/rooms/:id/members/:userId (legacy removeUserFromRoom). */
  async removeMember(session: Session, roomId: string, userId: string) {
    const member = await this.roomRepository.removeMember(session, roomId, userId);
    log.info("room_member_removed", { roomId: member.roomId, memberId: member.userId, actor: session.userId });
    return member;
  }

  /** GET /api/rooms/:id/admins — co-admins + admin (legacy fetchRoomAdmins). */
  async admins(roomId: string) {
    const items = await this.roomRepository.listAdmins(roomId);
    return paged(items, 1, items.length, items.length);
  }

  /** POST /api/rooms/:id/admins/:userId — promote to co-admin (legacy makeRoomAdmin). */
  async makeAdmin(session: Session, roomId: string, userId: string) {
    const member = await this.roomRepository.makeAdmin(session, roomId, userId);
    log.info("room_admin_promoted", { roomId: member.roomId, memberId: member.userId, actor: session.userId });
    return member;
  }

  /** DELETE /api/rooms/:id/admins/:userId — demote co-admin (legacy removeAdminFromRoom). */
  async removeAdmin(session: Session, roomId: string, userId: string) {
    const member = await this.roomRepository.removeAdmin(session, roomId, userId);
    log.info("room_admin_demoted", { roomId: member.roomId, memberId: member.userId, actor: session.userId });
    return member;
  }
}
