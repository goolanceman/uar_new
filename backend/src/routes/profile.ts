/**
 * Profile routes — /api/profile, /api/profile/analytics, /api/profile/password
 * Thin endpoint definitions; all logic lives in src/modules/profile
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/profile`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * Extended with the generic mobile-parity endpoints: community-profile edits
 * (PATCH with multipart), KYC verification, user-type selection and device
 * push-token registration.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { multipart } from "@/infrastructure/uploads/multipart";
import {
  deviceTokenSchema,
  passwordChangeSchema,
  profileUpdateSchema,
  userTypeSchema,
  verificationSchema,
} from "@/modules/profile/schemas/profile.schema";
import { profileController } from "@/modules/profile";

export const router = Router();

// GET /api/profile — the signed-in user's full record + role-aware extras
// (donor CRM stats / volunteer profile / beneficiary case). Used by the
// universal profile page for EVERY role.
router.get("/", authenticate, profileController.getSelf);

// PATCH /api/profile — self-service edits (name/phone/city/about/avatar and
// the community-profile fields: username, backgroundImage, interestIds,
// pushNotifications, roomInvites, block/saved lists). Accepts JSON bodies AND
// multipart/form-data (avatar/background image uploads — multer passes JSON
// content types straight through). Role and email are deliberately NOT
// editable here — that is an admin action in Users & Roles.
// (multer runs first, then the auth gate — legacy order.)
router.patch(
  "/",
  multipart,
  authenticate,
  validate({ body: profileUpdateSchema }),
  profileController.update
);

// POST /api/profile/verification — KYC submission (legacy profileVerification):
// multipart selfie + document, stamps the account isVerified=1 (pending review).
router.post(
  "/verification",
  multipart,
  authenticate,
  validate({ body: verificationSchema }),
  profileController.submitVerification
);

// POST /api/profile/user-type — one-time supporter|volunteer choice (legacy
// user/select-type). Volunteers enter the pending approval pipeline.
router.post("/user-type", authenticate, validate({ body: userTypeSchema }), profileController.selectUserType);

// POST /api/profile/device-token — register the push credentials of the
// signed-in user (legacy notifications/register-token).
router.post(
  "/device-token",
  authenticate,
  validate({ body: deviceTokenSchema }),
  profileController.registerDeviceToken
);

// DELETE /api/profile/device-token — clear the push credentials on logout
// (legacy /logOut cleared the device token).
router.delete("/device-token", authenticate, profileController.clearDeviceToken);

// GET /api/profile/analytics — role-aware aggregate object for the universal
// "My analytics" page (ADMIN activity trail, DONOR gift aggregates, VOLUNTEER
// task/attendance aggregates, BENEFICIARY help-request analytics).
router.get("/analytics", authenticate, profileController.getAnalytics);

// POST /api/profile/password — self-service password change {current, next}.
// (Field checks run in the service — legacy order and messages.)
router.post("/password", authenticate, validate({ body: passwordChangeSchema }), profileController.changePassword);
