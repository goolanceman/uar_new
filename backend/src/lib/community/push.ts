/**
 * Community push + live-feed helpers — shared by every generic community
 * router (web + mobile). Moved out of the mobile compat layer so the generic
 * routers never import from the legacy module.
 */
import { db } from "@/lib/db";
import { broadcastEvent } from "@/lib/events";

/**
 * Push notification — persists into the existing Notification model
 * (userId = User.id) so the mobile notification list and the admin dashboard
 * read the same stream. FCM delivery runs when FCM_SERVER_KEY is configured;
 * the row is the source of truth either way.
 */
export async function sendPush(opts: {
  userId: string;
  title: string;
  body: string;
  type?: string | null;
  data?: Record<string, unknown> | null;
}) {
  const user = await db.user.findUnique({
    where: { id: opts.userId },
    select: { fcmToken: true, apnsToken: true, deviceToken: true },
  });
  const deviceToken = user?.fcmToken || user?.apnsToken || user?.deviceToken || null;
  const platform = user?.fcmToken ? "android" : user?.apnsToken ? "ios" : null;

  const row = await db.notification.create({
    data: {
      userId: opts.userId,
      title: opts.title,
      message: opts.body,
      type: opts.type ?? "MOBILE",
      data: opts.data ? JSON.stringify(opts.data) : null,
      platform,
      deviceToken,
      sentVia: deviceToken ? "fcm" : "none",
    },
  });

  if (deviceToken && process.env.FCM_SERVER_KEY) {
    try {
      await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: {
          Authorization: `key=${process.env.FCM_SERVER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: deviceToken,
          notification: { title: opts.title, body: opts.body },
          data: (opts.data ?? {}) as Record<string, string>,
        }),
      });
    } catch (e) {
      console.error("[push] FCM delivery failed", e);
    }
  }
  return row;
}

/** Publish to the admin live feed (existing SSE infra) so the dashboard sees
 *  community activity without polling. */
export function feedEvent(eventName: string, payload: unknown) {
  broadcastEvent(eventName, payload);
}
