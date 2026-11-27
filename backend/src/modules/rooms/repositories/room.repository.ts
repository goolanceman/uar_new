/**
 * Implementation of the room repository — delegates to the pinned shared
 * domain layer @/domains/community/rooms, which owns all Prisma access for
 * community rooms (see the interface note). This module adds no Prisma calls
 * of its own.
 */
import type { Session } from "@/infrastructure/auth/session";
import * as rooms from "@/domains/community/rooms";
import type { RoomRepository } from "./room.repository.interface";

export class PrismaRoomRepository implements RoomRepository {
  listOwnRooms(userId: string, skip: number, take: number) {
    return rooms.listOwnRooms(userId, skip, take);
  }

  listJoinedRooms(userId: string, skip: number, take: number) {
    return rooms.listJoinedRooms(userId, skip, take);
  }

  listMemberships(userId: string, skip: number, take: number) {
    return rooms.listMemberships(userId, skip, take);
  }

  me(userId: string) {
    return rooms.me(userId);
  }

  getSuggestedRooms(me: { id: string; interestIds: string | null | undefined }) {
    return rooms.getSuggestedRooms(me);
  }

  listRandomRooms(userId: string, limit: number) {
    return rooms.listRandomRooms(userId, limit);
  }

  listInvitations(userId: string, skip: number, take: number) {
    return rooms.listInvitations(userId, skip, take);
  }

  listRoomsByInterest(userId: string, interestId: string, skip: number, take: number) {
    return rooms.listRoomsByInterest(userId, interestId, skip, take);
  }

  createRoom(session: Session, input: rooms.CreateRoomInput, photoUrl: string | null) {
    return rooms.createRoom(session, input, photoUrl);
  }

  roomDetail(userId: string, roomId: string, showMembers: boolean) {
    return rooms.roomDetail(userId, roomId, showMembers);
  }

  editRoom(session: Session, roomId: string, patch: rooms.EditRoomPatch, photoUrl: string | null) {
    return rooms.editRoom(session, roomId, patch, photoUrl);
  }

  deleteRoom(session: Session, roomId: string) {
    return rooms.deleteRoom(session, roomId);
  }

  joinRoom(session: Session, roomId: string) {
    return rooms.joinRoom(session, roomId);
  }

  leaveRoom(session: Session, roomId: string) {
    return rooms.leaveRoom(session, roomId);
  }

  reportRoom(session: Session, roomId: string, reason: string, desc: string) {
    return rooms.reportRoom(session, roomId, reason, desc);
  }

  setMute(session: Session, roomId: string, isMute?: number) {
    return rooms.setMute(session, roomId, isMute);
  }

  inviteUser(session: Session, roomId: string, userId: string) {
    return rooms.inviteUser(session, roomId, userId);
  }

  acceptInvitation(session: Session, roomId: string) {
    return rooms.acceptInvitation(session, roomId);
  }

  rejectInvitation(session: Session, roomId: string) {
    return rooms.rejectInvitation(session, roomId);
  }

  invitableUsers(session: Session, roomId: string, keyword: string, skip: number, take: number) {
    return rooms.invitableUsers(session, roomId, keyword, skip, take);
  }

  listRequests(session: Session, roomId: string, skip: number, take: number) {
    return rooms.listRequests(session, roomId, skip, take);
  }

  acceptRequest(session: Session, roomId: string, userId: string) {
    return rooms.acceptRequest(session, roomId, userId);
  }

  rejectRequest(session: Session, roomId: string, userId: string) {
    return rooms.rejectRequest(session, roomId, userId);
  }

  listMembers(roomId: string, skip: number, take: number) {
    return rooms.listMembers(roomId, skip, take);
  }

  removeMember(session: Session, roomId: string, userId: string) {
    return rooms.removeMember(session, roomId, userId);
  }

  listAdmins(roomId: string) {
    return rooms.listAdmins(roomId);
  }

  makeAdmin(session: Session, roomId: string, userId: string) {
    return rooms.makeAdmin(session, roomId, userId);
  }

  removeAdmin(session: Session, roomId: string, userId: string) {
    return rooms.removeAdmin(session, roomId, userId);
  }
}
