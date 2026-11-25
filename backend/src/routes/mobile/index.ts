/**
 * Mobile wire-compat router — /api endpoints consumed by the Flutter app
 * (mobile-restore). Mounted at `/api` BEFORE the existing routers; a request
 * is claimed here only when it carries the mobile `apikey` header (mobileGate),
 * so the uarnew admin endpoints with colliding paths (/api/auth/*,
 * /api/notifications/*, ...) keep working untouched.
 *
 * Module map (each file ports the exact legacy Laravel controller):
 *   auth-users.ts  AuthController, UserController, Moderator,
 *                  ProfileVerificationController, NotificationController,
 *                  AdminController, VolunteerApplicationController
 *   posts.ts       PostController, InterestController, uploadFile
 *   reels-rooms.ts ReelController (+music), RoomController
 *   chat-audio.ts  ChatController, AudioSpaceController, SettingsController,
 *                  FAQsController, broadcasting auth
 *   charity.ts     CauseController, DonationController, CharityCardController,
 *                  DonationPointsController, AchievementsController,
 *                  DonationGoalsController, CharityEventsController
 */
import { Router, type Request, type Response } from "express";
import { mobileGate, unauthorized, ok } from "@/lib/mobile/compat";
import { channelAuth } from "@/lib/mobile/pusher";

import { router as authUsersRouter } from "./auth-users";
import { router as postsRouter } from "./posts";
import { router as reelsRoomsRouter } from "./reels-rooms";
import { router as chatAudioRouter } from "./chat-audio";
import { router as charityRouter } from "./charity";

export const router = Router();

// Every mobile request carries apikey; anything else falls through.
router.use(mobileGate);

/**
 * /broadcasting/auth — Pusher private-channel authorization (websocket_service.dart
 * posts here with `Authorization: Bearer <jwt>`). Reuses the existing session
 * validation; signs the channel with the shared Pusher secret.
 */
export async function broadcastingAuthHandler(req: Request, res: Response) {
  try {
    const socketId = req.body?.socket_id;
    const channelName = req.body?.channel_name;
    if (!socketId || !channelName) {
      return res.status(401).json({ error: "Invalid auth request" });
    }
    const { validateSession } = await import("@/lib/session");
    const session = await validateSession(req);
    if (!session) return unauthorized(res, "Invalid or expired token");
    return res.json({ auth: channelAuth(socketId, channelName) });
  } catch (e) {
    console.error("[mobile] broadcasting auth failed", e);
    return res.status(500).json({ error: "auth failed" });
  }
}

// Health probe for the compat layer (used by smoke tests)
router.get("/mobile-ping", (_req, res) => ok(res, "pong"));

router.use(authUsersRouter);
router.use(postsRouter);
router.use(reelsRoomsRouter);
router.use(chatAudioRouter);
router.use(charityRouter);
