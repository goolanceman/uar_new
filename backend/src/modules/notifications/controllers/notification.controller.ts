/**
 * Notification controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validateSession } from "@/lib/session";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import type {
  ListNotificationsQuery,
  PlatformNotificationsQuery,
  PushNotificationBody,
  UpdateNotificationBody,
} from "../schemas/notification.schema";
import type { NotificationService } from "../services/notification.service";

export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /** GET /api/notifications?limit=20 — optional session (validateSession, the
   *  legacy mid-handler call): signed-in users also get their own rows. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListNotificationsQuery>(req);
      const session = await validateSession(req);
      const payload = await this.notificationService.list(query, session);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/notifications — { id, isRead } or { all: true }. */
  markRead: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<UpdateNotificationBody>(req);
      const result = await this.notificationService.markRead(body, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/notifications/platform — global announcements feed. */
  platform: RequestHandler = async (req, res, next) => {
    try {
      const { page, limit } = validatedQuery<PlatformNotificationsQuery>(req);
      const payload = await this.notificationService.platform(page, limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/notifications/push — persist + deliver one push notification. */
  push: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<PushNotificationBody>(req);
      const result = await this.notificationService.push(body, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
