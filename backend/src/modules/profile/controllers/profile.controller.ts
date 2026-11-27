/**
 * Profile controller — HTTP layer only. Extracts the verified session,
 * validated body, multipart file parts and the request origin, delegates to
 * the service, returns the response. Errors render through the lib
 * handleError (the legacy per-route catch contract — identical JSON body
 * and status, safe in bare test harnesses without an error middleware).
 * the legacy per-route catch used, so response bodies are byte-identical.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { handleError } from "@/infrastructure/auth/session";
import { validatedBody } from "@/shared/middleware/validate";
import { filePart } from "@/infrastructure/uploads/multipart";
import type {
  DeviceTokenBody,
  PasswordChangeBody,
  ProfileUpdateBody,
  UserTypeBody,
  VerificationBody,
} from "../schemas/profile.schema";
import type { ProfileEditFiles, ProfileService, VerificationFiles } from "../services/profile.service";

export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** Absolute public URL prefix for stored assets (the legacy saveFieldFile
   *  host/proto resolution — an HTTP concern, so it lives here). */
  private origin(req: Request): string {
    const host = req.get("host") ?? "localhost";
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
    return `${proto}://${host}`;
  }

  /** GET /api/profile — full record + role-aware extras. */
  getSelf: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.profileService.getSelf(req.session!);
      res.json(payload);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** PATCH /api/profile — self-service edits (JSON or multipart; the multer
   *  middleware passes JSON content types straight through). */
  update: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<ProfileUpdateBody>(req);
      const files: ProfileEditFiles = {
        avatar: filePart(req, "avatar"),
        profile: filePart(req, "profile"),
        backgroundImage: filePart(req, "backgroundImage"),
        background_image: filePart(req, "background_image"),
      };
      const payload = await this.profileService.update(req.session!, body, files, this.origin(req));
      res.json(payload);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** POST /api/profile/verification — KYC submission (multipart selfie +
   *  document). */
  submitVerification: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<VerificationBody>(req);
      const files: VerificationFiles = {
        selfie: filePart(req, "selfie"),
        document: filePart(req, "document"),
      };
      const payload = await this.profileService.submitVerification(req.session!, body, files, this.origin(req));
      res.json(payload);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** POST /api/profile/user-type — one-time supporter|volunteer choice. */
  selectUserType: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<UserTypeBody>(req);
      const payload = await this.profileService.selectUserType(req.session!, body);
      res.json(payload);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** POST /api/profile/device-token — register the push credentials. */
  registerDeviceToken: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<DeviceTokenBody>(req);
      const payload = await this.profileService.registerDeviceToken(req.session!, body);
      res.json(payload);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** DELETE /api/profile/device-token — clear the push credentials on logout. */
  clearDeviceToken: RequestHandler = async (req, res, next) => {
    try {
      const payload = await this.profileService.clearDeviceToken(req.session!);
      res.json(payload);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** GET /api/profile/analytics — role-aware aggregate object. */
  getAnalytics: RequestHandler = async (req, res, next) => {
    try {
      const payload = await this.profileService.getAnalytics(req.session!);
      res.json(payload);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** POST /api/profile/password — self-service password change. */
  changePassword: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<PasswordChangeBody>(req);
      const payload = await this.profileService.changePassword(req.session!, body);
      res.json(payload);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };
}
