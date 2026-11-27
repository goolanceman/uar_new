/**
 * Room controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 *
 * Two legacy helpers stay here because they touch the raw request: the
 * `param()` guard (exact "id is required" 400) and the multipart photo
 * storage (saveUpload + absolute URL from req headers) — the latter keeps the
 * legacy mid-handler `await requireAuth(req)` re-check.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requireAuth } from "@/lib/session";
import { ApiError } from "@/shared/errors";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import { type MulterFile } from "@/lib/multipart";
import { saveUpload } from "@/lib/files";
import type {
  DefaultPageQuery,
  InterestIdParams,
  InvitableUsersQuery,
  OwnRoomsQuery,
  RandomRoomsQuery,
  RoomBody,
  RoomDetailQuery,
  RoomIdParams,
  RoomUserParams,
} from "../schemas/room.schema";
import type { RoomService } from "../services/room.service";

export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  /** Path :param guard — reject missing/blank ids early (legacy helper). */
  private param(req: Request, name: string): string {
    const params = validatedParams<Record<string, string>>(req) ?? {};
    const v = String(params[name] ?? "").trim();
    if (!v) throw new ApiError(`${name} is required`, 400);
    return v;
  }

  /** The uploaded file for a multipart field, or null (same as routes/profile.ts). */
  private fieldFile(req: Request, fieldname: string): File | null {
    const files = ((req as Request & { files?: unknown }).files ?? []) as Array<MulterFile & { fieldname?: string }>;
    const f = files.find((x) => x.fieldname === fieldname);
    if (!f) return null;
    return new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" });
  }

  /** Store an uploaded room photo and return its absolute public URL. */
  private async savePhoto(req: Request, fieldname: string): Promise<string | null> {
    const file = this.fieldFile(req, fieldname);
    if (!file) return null;
    const session = await requireAuth(req);
    const asset = await saveUpload(file, { folder: "rooms", uploadedBy: { id: session.userId, name: session.name } });
    const host = req.get("host") ?? "localhost";
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
    return `${proto}://${host}/api/files/${asset.id}/file`;
  }

  /** GET /api/rooms/mine — rooms I own (legacy fetchMyOwnRooms). */
  mine: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<OwnRoomsQuery>(req);
      const payload = await this.roomService.mine(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/joined — memberships (2|3|5) with the room. */
  joined: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<OwnRoomsQuery>(req);
      const payload = await this.roomService.joined(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/memberships — every room_users row of mine. */
  memberships: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<OwnRoomsQuery>(req);
      const payload = await this.roomService.memberships(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/suggested — up to 2 public rooms I'm not in. */
  suggested: RequestHandler = async (req, res, next) => {
    try {
      const payload = await this.roomService.suggested(req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/random — random public rooms. */
  random: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<RandomRoomsQuery>(req);
      const payload = await this.roomService.random(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/invitations — my pending invitations. */
  invitations: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<DefaultPageQuery>(req);
      const payload = await this.roomService.invitations(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/by-interest/:interestId — public, non-full rooms. */
  byInterest: RequestHandler = async (req, res, next) => {
    try {
      const interestId = this.param(req, "interestId");
      const query = validatedQuery<DefaultPageQuery>(req);
      const payload = await this.roomService.byInterest(req.session!, interestId, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms — create a room (multipart photo; legacy createRoom). */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = (validatedBody<RoomBody>(req) ?? {}) as RoomBody;
      const photoUrl = await this.savePhoto(req, "photo");
      const room = await this.roomService.create(req.session!, body, photoUrl);
      res.json(room);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/:id — detail + auto conversation (+ members with ?showMembers=1). */
  detail: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const { showMembers } = validatedQuery<RoomDetailQuery>(req) ?? ({} as RoomDetailQuery);
      const detail = await this.roomService.detail(req.session!, id, showMembers);
      res.json(detail);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/rooms/:id — edit (multipart photo; legacy editRoom). */
  update: RequestHandler = async (req, res, next) => {
    try {
      const body = (validatedBody<RoomBody>(req) ?? {}) as RoomBody;
      const photoUrl = await this.savePhoto(req, "photo");
      const id = this.param(req, "id");
      const room = await this.roomService.update(req.session!, id, body, photoUrl);
      res.json(room);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/rooms/:id — room admin OR moderator. */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const room = await this.roomService.remove(req.session!, id);
      res.json(room);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/join — join request or direct join. */
  join: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const member = await this.roomService.join(req.session!, id);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/leave — leave. */
  leave: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const member = await this.roomService.leave(req.session!, id);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/report — { reason, desc }. */
  report: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const body = (validatedBody<RoomBody>(req) ?? {}) as RoomBody;
      const report = await this.roomService.report(req.session!, id, body);
      res.json(report);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/mute — { isMute? } set or toggle. */
  mute: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const body = (validatedBody<RoomBody>(req) ?? {}) as RoomBody;
      const member = await this.roomService.mute(req.session!, id, body);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/invitations — { userId } invite. */
  invite: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const body = (validatedBody<RoomBody>(req) ?? {}) as RoomBody;
      const member = await this.roomService.invite(req.session!, id, body);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/invitations/accept — my invitation. */
  acceptInvitation: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const member = await this.roomService.acceptInvitation(req.session!, id);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/invitations/reject — my invitation. */
  rejectInvitation: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const member = await this.roomService.rejectInvitation(req.session!, id);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/:id/invitable-users?q= — invite picker. */
  invitableUsers: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const query = validatedQuery<InvitableUsersQuery>(req);
      const payload = await this.roomService.invitableUsers(req.session!, id, query.q, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/:id/requests — pending join requests. */
  requests: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const query = validatedQuery<DefaultPageQuery>(req);
      const payload = await this.roomService.requests(req.session!, id, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/requests/:userId/accept. */
  acceptRequest: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const userId = this.param(req, "userId");
      const member = await this.roomService.acceptRequest(req.session!, id, userId);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/requests/:userId/reject. */
  rejectRequest: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const userId = this.param(req, "userId");
      const member = await this.roomService.rejectRequest(req.session!, id, userId);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/:id/members — member list. */
  members: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const query = validatedQuery<DefaultPageQuery>(req);
      const payload = await this.roomService.members(id, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/rooms/:id/members/:userId. */
  removeMember: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const userId = this.param(req, "userId");
      const member = await this.roomService.removeMember(req.session!, id, userId);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/rooms/:id/admins — co-admins + admin. */
  admins: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const payload = await this.roomService.admins(id);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/rooms/:id/admins/:userId — promote to co-admin. */
  makeAdmin: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const userId = this.param(req, "userId");
      const member = await this.roomService.makeAdmin(req.session!, id, userId);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/rooms/:id/admins/:userId — demote co-admin. */
  removeAdmin: RequestHandler = async (req, res, next) => {
    try {
      const id = this.param(req, "id");
      const userId = this.param(req, "userId");
      const member = await this.roomService.removeAdmin(req.session!, id, userId);
      res.json(member);
    } catch (error) {
      next(error);
    }
  };
}
