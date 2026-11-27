/**
 * Room repository contract — persistence operations for community rooms.
 * The module has NO direct Prisma access of its own: all persistence lives in
 * the pinned shared domain layer @/lib/community/rooms (which owns the
 * CommunityRoom/CommunityRoomUser/Conversation tables). This repository wraps
 * those calls as the module's persistence boundary; the service layer depends
 * on this interface only.
 */
import type { Session } from "@/lib/session";
import * as rooms from "@/lib/community/rooms";

type OwnRooms = Awaited<ReturnType<typeof rooms.listOwnRooms>>;
type JoinedRooms = Awaited<ReturnType<typeof rooms.listJoinedRooms>>;
type Memberships = Awaited<ReturnType<typeof rooms.listMemberships>>;
type MeProfile = Awaited<ReturnType<typeof rooms.me>>;
type SuggestedRooms = Awaited<ReturnType<typeof rooms.getSuggestedRooms>>;
type RandomRooms = Awaited<ReturnType<typeof rooms.listRandomRooms>>;
type Invitations = Awaited<ReturnType<typeof rooms.listInvitations>>;
type RoomsByInterest = Awaited<ReturnType<typeof rooms.listRoomsByInterest>>;
type CreatedRoom = Awaited<ReturnType<typeof rooms.createRoom>>;
type RoomDetail = Awaited<ReturnType<typeof rooms.roomDetail>>;
type EditedRoom = Awaited<ReturnType<typeof rooms.editRoom>>;
type DeletedRoom = Awaited<ReturnType<typeof rooms.deleteRoom>>;
type RoomMember = Awaited<ReturnType<typeof rooms.joinRoom>>;
type RoomReport = Awaited<ReturnType<typeof rooms.reportRoom>>;
type InvitableUsers = Awaited<ReturnType<typeof rooms.invitableUsers>>;
type RoomRequests = Awaited<ReturnType<typeof rooms.listRequests>>;
type RoomMembers = Awaited<ReturnType<typeof rooms.listMembers>>;
type RemovedMember = Awaited<ReturnType<typeof rooms.removeMember>>;
type RoomAdmins = Awaited<ReturnType<typeof rooms.listAdmins>>;

export interface RoomRepository {
  listOwnRooms(userId: string, skip: number, take: number): Promise<OwnRooms>;
  listJoinedRooms(userId: string, skip: number, take: number): Promise<JoinedRooms>;
  listMemberships(userId: string, skip: number, take: number): Promise<Memberships>;
  me(userId: string): Promise<MeProfile>;
  getSuggestedRooms(me: { id: string; interestIds: string | null | undefined }): Promise<SuggestedRooms>;
  listRandomRooms(userId: string, limit: number): Promise<RandomRooms>;
  listInvitations(userId: string, skip: number, take: number): Promise<Invitations>;
  listRoomsByInterest(userId: string, interestId: string, skip: number, take: number): Promise<RoomsByInterest>;

  createRoom(session: Session, input: rooms.CreateRoomInput, photoUrl: string | null): Promise<CreatedRoom>;
  roomDetail(userId: string, roomId: string, showMembers: boolean): Promise<RoomDetail>;
  editRoom(session: Session, roomId: string, patch: rooms.EditRoomPatch, photoUrl: string | null): Promise<EditedRoom>;
  deleteRoom(session: Session, roomId: string): Promise<DeletedRoom>;

  joinRoom(session: Session, roomId: string): Promise<RoomMember>;
  leaveRoom(session: Session, roomId: string): Promise<RoomMember>;
  reportRoom(session: Session, roomId: string, reason: string, desc: string): Promise<RoomReport>;
  setMute(session: Session, roomId: string, isMute?: number): Promise<RoomMember>;
  inviteUser(session: Session, roomId: string, userId: string): Promise<RoomMember>;
  acceptInvitation(session: Session, roomId: string): Promise<RoomMember>;
  rejectInvitation(session: Session, roomId: string): Promise<RoomMember>;

  invitableUsers(session: Session, roomId: string, keyword: string, skip: number, take: number): Promise<InvitableUsers>;
  listRequests(session: Session, roomId: string, skip: number, take: number): Promise<RoomRequests>;
  acceptRequest(session: Session, roomId: string, userId: string): Promise<RoomMember>;
  rejectRequest(session: Session, roomId: string, userId: string): Promise<RoomMember>;

  listMembers(roomId: string, skip: number, take: number): Promise<RoomMembers>;
  removeMember(session: Session, roomId: string, userId: string): Promise<RemovedMember>;

  listAdmins(roomId: string): Promise<RoomAdmins>;
  makeAdmin(session: Session, roomId: string, userId: string): Promise<RoomMember>;
  removeAdmin(session: Session, roomId: string, userId: string): Promise<RoomMember>;
}
