/**
 * Notifications routes — /api/notifications
 * Thin endpoint definitions; all logic lives in src/modules/notifications
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/notifications`) is preserved: tests and the app entry
 * import `router` from here.
 *
 * Extended with the generic mobile-parity endpoints: ?feed=all (the community
 * saved-notification feed), /platform (global announcements) and /push
 * (admin/moderator push, plus chat-type pushes between conversation
 * participants).
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listNotificationsQuerySchema,
  platformNotificationsQuerySchema,
  pushNotificationBodySchema,
  updateNotificationBodySchema,
} from "@/modules/notifications/schemas/notification.schema";
import { notificationController } from "@/modules/notifications";

export const router = Router();

// GET /api/notifications?limit=20 — latest notifications for the signed-in
// user, always merged with global announcements (userId = null). Without a
// session only global rows are returned. (Legacy optional-session read via
// `await validateSession(req)` — kept in the controller.) Optional pagination
// (gap A-8): with ?page (and optional ?limit) the response becomes
// { items, total, page, pages }; without it the legacy array shape is
// returned exactly as before. ?feed=all switches to the COMMUNITY feed
// (saved notifications + chat pushes — the legacy fetchUserNotification
// shape, camelCase).
router.get("/", validate({ query: listNotificationsQuerySchema }), notificationController.list);

// PATCH /api/notifications — { id, isRead } marks one row, { all: true }
// marks every unread row of the signed-in user as read. (Legacy gate: `await
// requireAuth(req)` as the handler's first step.)
router.patch(
  "/",
  authenticate,
  validate({ body: updateNotificationBodySchema }),
  notificationController.markRead
);

// GET /api/notifications/platform — global announcements (Notification rows
// with userId = null) in the legacy fetchPlatformNotification shape.
router.get(
  "/platform",
  validate({ query: platformNotificationsQuerySchema }),
  notificationController.platform
);

// POST /api/notifications/push — persist + deliver one push notification
// (replaces the legacy pushNotificationToSingleUser). (Legacy gate: `await
// requireAuth(req)` as the handler's first step.)
router.post(
  "/push",
  authenticate,
  validate({ body: pushNotificationBodySchema }),
  notificationController.push
);
