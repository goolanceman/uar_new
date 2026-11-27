/**
 * Community rooms routes — /api/rooms (shared by web + mobile).
 * Thin endpoint definitions; all logic lives in src/modules/rooms
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/rooms`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * The actor is ALWAYS the session user (legacy-first-step `requireAuth` →
 * `authenticate` middleware); room admin checks read CommunityRoomUser rows
 * and moderators are role ADMIN/MODERATOR or User.isModerator — all inside
 * the shared domain layer @/domains/community/rooms.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { multipart } from "@/infrastructure/uploads/multipart";
import {
  defaultPageQuerySchema,
  invitableUsersQuerySchema,
  interestIdParamsSchema,
  ownRoomsQuerySchema,
  randomRoomsQuerySchema,
  roomBodySchema,
  roomDetailQuerySchema,
  roomIdParamsSchema,
  roomUserParamsSchema,
} from "@/modules/rooms/schemas/room.schema";
import { roomsController } from "@/modules/rooms";

export const router = Router();

// GET /api/rooms/mine — rooms I own (legacy fetchMyOwnRooms).
router.get("/mine", authenticate, validate({ query: ownRoomsQuerySchema }), roomsController.mine);

// GET /api/rooms/joined — memberships (2|3|5) with the room (legacy fetchRoomsList).
router.get("/joined", authenticate, validate({ query: ownRoomsQuerySchema }), roomsController.joined);

// GET /api/rooms/memberships — every room_users row of mine (legacy fetchRoomsIAmIn).
router.get("/memberships", authenticate, validate({ query: ownRoomsQuerySchema }), roomsController.memberships);

// GET /api/rooms/suggested — up to 2 public rooms I'm not in, preferring my
// interests (legacy getSuggestedRooms / fetchSuggestedRooms — also feeds the
// posts router).
router.get("/suggested", authenticate, roomsController.suggested);

// GET /api/rooms/random — random public rooms (legacy fetchRandomRooms).
router.get("/random", authenticate, validate({ query: randomRoomsQuerySchema }), roomsController.random);

// GET /api/rooms/invitations — my pending invitations (legacy getInvitationList).
// NOTE: mounted before /:id so "invitations" is not swallowed by the param route.
router.get("/invitations", authenticate, validate({ query: defaultPageQuerySchema }), roomsController.invitations);

// GET /api/rooms/by-interest/:interestId — public, non-full rooms for an interest
// (legacy fetchRoomsByInterest).
router.get(
  "/by-interest/:interestId",
  authenticate,
  validate({ params: interestIdParamsSchema, query: defaultPageQuerySchema }),
  roomsController.byInterest
);

// POST /api/rooms — create a room (multipart photo; legacy createRoom).
router.post("/", multipart, authenticate, validate({ body: roomBodySchema }), roomsController.create);

// GET /api/rooms/:id — detail + auto conversation (+ members with ?showMembers=1).
router.get(
  "/:id",
  authenticate,
  validate({ params: roomIdParamsSchema, query: roomDetailQuerySchema }),
  roomsController.detail
);

// PATCH /api/rooms/:id — edit (multipart photo; legacy editRoom).
router.patch(
  "/:id",
  multipart,
  authenticate,
  validate({ params: roomIdParamsSchema, body: roomBodySchema }),
  roomsController.update
);

// DELETE /api/rooms/:id — room admin OR moderator (legacy deleteRoom +
// Moderator/deleteRoomByModerator).
router.delete("/:id", authenticate, validate({ params: roomIdParamsSchema }), roomsController.remove);

// POST /api/rooms/:id/join — join request or direct join (legacy joinOrRequestRoom).
router.post("/:id/join", authenticate, validate({ params: roomIdParamsSchema }), roomsController.join);

// POST /api/rooms/:id/leave — leave (legacy leaveThisRoom).
router.post("/:id/leave", authenticate, validate({ params: roomIdParamsSchema }), roomsController.leave);

// POST /api/rooms/:id/report — { reason, desc } (legacy reportRoom).
router.post(
  "/:id/report",
  authenticate,
  validate({ params: roomIdParamsSchema, body: roomBodySchema }),
  roomsController.report
);

// POST /api/rooms/:id/mute — { isMute? } set or toggle (legacy muteUnmuteRoomNotification).
router.post(
  "/:id/mute",
  authenticate,
  validate({ params: roomIdParamsSchema, body: roomBodySchema }),
  roomsController.mute
);

// POST /api/rooms/:id/invitations — { userId } invite (legacy inviteUserToRoom).
router.post(
  "/:id/invitations",
  authenticate,
  validate({ params: roomIdParamsSchema, body: roomBodySchema }),
  roomsController.invite
);

// POST /api/rooms/:id/invitations/accept — my invitation (legacy acceptInvitation).
router.post(
  "/:id/invitations/accept",
  authenticate,
  validate({ params: roomIdParamsSchema }),
  roomsController.acceptInvitation
);

// POST /api/rooms/:id/invitations/reject — my invitation (legacy rejectInvitation).
router.post(
  "/:id/invitations/reject",
  authenticate,
  validate({ params: roomIdParamsSchema }),
  roomsController.rejectInvitation
);

// GET /api/rooms/:id/invitable-users?q= — invite picker (legacy searchUserForInvitation).
router.get(
  "/:id/invitable-users",
  authenticate,
  validate({ params: roomIdParamsSchema, query: invitableUsersQuerySchema }),
  roomsController.invitableUsers
);

// GET /api/rooms/:id/requests — pending join requests (legacy fetchRoomRequestList).
router.get(
  "/:id/requests",
  authenticate,
  validate({ params: roomIdParamsSchema, query: defaultPageQuerySchema }),
  roomsController.requests
);

// POST /api/rooms/:id/requests/:userId/accept (legacy acceptRoomRequest).
router.post(
  "/:id/requests/:userId/accept",
  authenticate,
  validate({ params: roomUserParamsSchema }),
  roomsController.acceptRequest
);

// POST /api/rooms/:id/requests/:userId/reject (legacy rejectRoomRequest).
router.post(
  "/:id/requests/:userId/reject",
  authenticate,
  validate({ params: roomUserParamsSchema }),
  roomsController.rejectRequest
);

// GET /api/rooms/:id/members — member list (legacy fetchRoomUsersList).
router.get(
  "/:id/members",
  authenticate,
  validate({ params: roomIdParamsSchema, query: defaultPageQuerySchema }),
  roomsController.members
);

// DELETE /api/rooms/:id/members/:userId (legacy removeUserFromRoom).
router.delete(
  "/:id/members/:userId",
  authenticate,
  validate({ params: roomUserParamsSchema }),
  roomsController.removeMember
);

// GET /api/rooms/:id/admins — co-admins + admin (legacy fetchRoomAdmins).
router.get("/:id/admins", authenticate, validate({ params: roomIdParamsSchema }), roomsController.admins);

// POST /api/rooms/:id/admins/:userId — promote to co-admin (legacy makeRoomAdmin).
router.post(
  "/:id/admins/:userId",
  authenticate,
  validate({ params: roomUserParamsSchema }),
  roomsController.makeAdmin
);

// DELETE /api/rooms/:id/admins/:userId — demote co-admin (legacy removeAdminFromRoom).
router.delete(
  "/:id/admins/:userId",
  authenticate,
  validate({ params: roomUserParamsSchema }),
  roomsController.removeAdmin
);
