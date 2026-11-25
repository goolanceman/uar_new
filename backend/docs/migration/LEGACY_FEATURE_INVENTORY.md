# Legacy Feature Inventory — UAR Legacy PHP Backend

**Source repo (READ-ONLY audit):** `/Users/mansoorkhan/Documents/works/uar/php/admin`
**Framework:** Laravel 9 (`composer.json` → `laravel/framework: ^9.0`, `laravel/sanctum: ^2.11`, `beyondcode/laravel-websockets`, `google/apiclient`, `razorpay/razorpay`, `league/flysystem-aws-s3-v3`)
**Audit date:** 2026-11-16
**Related docs:** `LEGACY_API_INVENTORY.md` (endpoint contracts), `LEGACY_DATABASE_MAPPING.md` (tables → Prisma mapping)

**How to read status:**
- `ACTIVE` — wired to routes and used in code paths (and, where noted, actually called by the Flutter app).
- `PARTIAL` — implemented but incomplete (TODOs, dual implementations, or superseded by a V2 in the same codebase).
- `DEAD_CODE` — present but not reachable from any route (or only reachable via leftover test routes).

**"Mobile-relevant?"** = cross-checked against the Flutter app at `../mobile/lib` (endpoint constants in `mobile/lib/utilities/web_service.dart` + services in `mobile/lib/common/api_service/*`; 97 unique legacy endpoints referenced). Mobile-relevant ≠ new-backend-must-clone 1:1; see per-feature notes.

---

## 1. Authentication & Account Lifecycle

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 1.1 | **Legacy social/simple login (`addUser`)** — find-or-create user by `identity` + `login_type`, updates device token. No password. Returns raw user; **no token issued** | Auth | ACTIVE (primary mobile login) | `routes/api.php` L84 (`UserController::addUser`, app/Http/Controllers/UserController.php L618) | YES — mobile calls `addUser` (`mobile/lib/common/api_service/user_service.dart`; only header sent is `apikey`, `mobile/lib/common/api_service/api_service.dart` L25) |
| 1.2 | **Sanctum email/password register** — creates user, username auto-derived from email, token 7-day expiry | Auth | ACTIVE (new-style; NOT called by current Flutter lib) | `AuthController::register` (app/Http/Controllers/AuthController.php L24–67) | NO (not in mobile endpoint list) |
| 1.3 | **Sanctum login** — email+password, revokes all previous tokens, 7-day token | Auth | ACTIVE (used by `test_apis.sh`) | `AuthController::login` (AuthController.php L81–113) | NO |
| 1.4 | Logout (revoke current token) / refresh / me | Auth | ACTIVE | `AuthController::logout/refresh/me` (AuthController.php L122–176) | NO (mobile uses legacy `logOut` 1.8) |
| 1.5 | Forgot password via 6-digit OTP stored (hashed) in `password_resets`, 15-min TTL. **OTP returned in response with `// TODO: Send OTP via email`** — email sending NOT implemented | Auth | PARTIAL (no email transport) | `AuthController::forgotPassword` (AuthController.php L185–216) | NO |
| 1.6 | Reset password via OTP; revokes all tokens on success | Auth | ACTIVE | `AuthController::resetPassword` (AuthController.php L225–277) | NO |
| 1.7 | Email verification OTP (reuses `password_resets` table; also returns OTP in response) | Auth | PARTIAL | `AuthController::sendVerificationOTP` / `verifyEmail` (AuthController.php L284–366) | NO |
| 1.8 | **Legacy logout** `logOut` — clears device_token fields | Auth | ACTIVE (mobile uses this) | `UserController::logOut` (UserController.php L1489) | YES |
| 1.9 | Legacy account delete `deleteUser` | Auth | ACTIVE (mobile) | `UserController::deleteUser` (UserController.php L1300) | YES |
| 1.10 | Sanctum account delete `auth/delete-account` (optional password confirm) | Auth | ACTIVE | `AuthController::deleteAccount` (AuthController.php L388–412) | NO |
| 1.11 | API-key gate — every API request must send `HTTP_APIKEY` header equal to a fixed value | Auth (transport) | ACTIVE | `app/Http/Middleware/CheckHeader.php` | YES (mobile sends `apikey` header) |
| 1.12 | Token bridge middleware — reads token from `HTTP_AUTHTOKEN` header and rewrites to `Authorization: Bearer …` for Sanctum | Auth (transport) | ACTIVE | `app/Http/Middleware/AuthorizeUser.php` | NO (mobile never sends authtoken) |
| 1.13 | Admin web session auth — `admins` table, session-based, Laravel-encrypted password blob | Auth (admin panel) | ACTIVE | `app/Http/Middleware/CheckLogin.php`, `LoginController::checklogin` (app/Http/Controllers/LoginController.php L28) | NO (admin-only) |
| 1.14 | Admin password change | Admin/Settings | ACTIVE | `AdminController::changePassword` (app/Http/Controllers/AdminController.php L152) | NO |

## 2. Users, Profile & Social Graph

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 2.1 | Edit profile (name, bio, interests, avatar upload) | Other (social) | ACTIVE (mobile) | `UserController::editProfile` (UserController.php L661) | YES |
| 2.2 | Follow / unfollow user (`following_lists`) | Other (social) | ACTIVE (mobile) | `UserController::followUser` (L735), `unfollowUser` (L874) | YES |
| 2.3 | Followers / following lists, search follower, search profile | Other (social) | ACTIVE (mobile) | `fetchFollowingList` (L810), `fetchFollowersList` (L831), `searchFollower`/`searchProfile` (L1409) | YES |
| 2.4 | Random profile suggestions | Other (social) | ACTIVE (mobile) | `fetchRandomProfile` (L942) | YES |
| 2.5 | Username availability check (incl. `username_restrictions` table) | Other (social) | ACTIVE (mobile) | `checkUsername` (L926); restrictions admin: `RestrictionController` (app/Http/Controllers/RestrictionController.php) | YES |
| 2.6 | Block / unblock user (CSV column `users.block_user_ids`), blocked list | Other (social) | ACTIVE (mobile) | `UserBlockedByUser` (L1561), `UserUnblockedByUser` (L1642), `fetchBlockedUserList` (L1459) | YES |
| 2.7 | Report user / post / reel / room (`reports` table) | Other (social) | ACTIVE (mobile) | `reportUser` (L1074); `PostController::reportPost` (L600); `ReelController::reportReel` (L716); `RoomController::reportRoom` (L974) | YES |
| 2.8 | User notifications feed (legacy) — `saved_notifications` rows generated on follow/like/comment/invite | Notifications | ACTIVE (mobile) | `fetchUserNotification` (UserController.php L1687 — reads `SavedNotification` model, table `saved_notifications`) | YES (mobile polls this) |
| 2.9 | User type selection (one-time): `supporter` or `volunteer`; volunteer → `volunteer_status=pending` | Volunteer | ACTIVE (new-style; not called by mobile lib) | `UserController::selectUserType` (UserController.php L2109) | NO |
| 2.10 | User verification badges (`is_verified`: 0 none, 1 pending, 2 verified, 3 subscribe-verified) | Other | ACTIVE | `Constants.php` (app/Models/Constants.php), `ProfileVerificationController` | YES (`profileVerification` endpoint) |

## 3. Beneficiary / KYC-style verification

There is **no dedicated beneficiary module** in the legacy app. The closest analogues are KYC profile verification and (in the new backend) the Beneficiary model.

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 3.1 | Profile verification submission — upload selfie + document + document_type + full_name; sets `users.is_verified=1` (pending) | Beneficiary (KYC) | ACTIVE (mobile) | `ProfileVerificationController::profileVerification` (app/Http/Controllers/ProfileVerificationController.php L18–76); admin review: `profileVerificationList` (L78), `approvedProfileVerification` (L155), `rejectProfileVerification` (L181) via web routes (`routes/web.php` L141–144) | YES |
| 3.2 | Document types master data (admin CRUD) | Settings | ACTIVE (web) | `SettingsController::addDocumentType` (app/Http/Controllers/SettingsController.php L271), `documentTypeList` (L221), `updateDocumentType` (L295), `deleteDocumentType` (L325); table `document_types` | Partial (types served via `fetchSetting`) |

## 4. Volunteer workflows

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 4.1 | Volunteer application submit — skills[], availability{}, city/state/country/geo, service_areas, motivation, experience, emergency contact, address | Volunteer | ACTIVE (API) — not referenced in Flutter lib | `VolunteerApplicationController::apply` (app/Http/Controllers/VolunteerApplicationController.php L15–127); route `POST /api/volunteer/apply` (routes/api.php L313) | NO (not in mobile endpoints) |
| 4.2 | Application status query | Volunteer | ACTIVE | `VolunteerApplicationController::status` (L129) | NO |
| 4.3 | Admin list / approve / reject applications (API, `isAdmin` middleware) | Volunteer/Admin | ACTIVE | `listApplications` (L183), `approve` (L212), `reject` (L301); routes api.php L320–323 | NO |
| 4.4 | Admin web UI for volunteer applications (Blade views) | Volunteer/Admin | ACTIVE | `volunteerApplicationsView` (L394), `volunteerApplicationsList` (L402), `getApplicationDetails` (L469), `approveWeb` (L489), `rejectWeb` (L497); routes web.php L147–151 | NO |
| 4.5 | Approve/reject updates `users.user_type/volunteer_status/volunteer_approved_*` and sends push | Volunteer | ACTIVE | `VolunteerApplicationController::approve` (L212+, writes User fields per migration `2026_06_24_180000_add_user_type_to_users_table.php`) | NO |

## 5. Donor & Charity gamification (Profile V2)

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 5.1 | Charity Card — get my card, tier info, verify card, share card, stats; card number `CHR-…` generated; tiers bronze/silver/gold/platinum from donation points | Donor | ACTIVE (API) — not referenced in Flutter lib | `CharityCardController` (app/Http/Controllers/CharityCardController.php, all methods L28–235); routes api.php L336–345; business rules in `app/Services/CharityCardService.php` (2 pts/₹, impact multiplier, level thresholds 500/2500/10000) | NO |
| 5.2 | Donation points ledger — balance, history, expiring, redeem, summary | Donor | ACTIVE (API) | `DonationPointsController` (app/Http/Controllers/DonationPointsController.php L20–218); table `donation_points` | NO |
| 5.3 | Achievements — catalog, my achievements, claim, progress, summary | Donor | ACTIVE (API) | `AchievementsController` (app/Http/Controllers/AchievementsController.php L20–253); tables `achievements`, `user_achievements` | NO |
| 5.4 | Donation goals — personal goal CRUD + complete + summary | Donor | ACTIVE (API) | `DonationGoalsController` (app/Http/Controllers/DonationGoalsController.php L19–286); table `donation_goals` | NO |
| 5.5 | Charity events — list, details, register, QR check-in, my events, cancel | Donor/Campaigns | ACTIVE (API) | `CharityEventsController` (app/Http/Controllers/CharityEventsController.php L20–294); tables `charity_events`, `event_participants` | NO |
| 5.6 | Impact metrics endpoint (alias of card stats) | Donor | ACTIVE (API) | routes api.php L354 (`GET /api/charity/impact` → `CharityCardController::getCardStats`) | NO |
| 5.7 | Charity card sync console command (`charity:sync-cards {user_id?}`) | Admin | ACTIVE (manual run; NOT scheduled) | `app/Console/Commands/SyncCharityCards.php` | NO |
| 5.8 | Users table denormalized charity fields (`total_points`, `lifetime_donated`, `impact_score`, `current_tier`, `member_since`) | Donor | ACTIVE | migration `2026_06_25_090511_add_charity_fields_to_users_table.php` | NO |

## 6. Causes & Donations (money movement)

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 6.1 | Create cause (post `type='cause'`, goal_amount, deadline, category; pending admin verification `is_verified=0`) | Campaigns | ACTIVE — tested (Week-1 results) | `CauseController::createCause` (app/Http/Controllers/CauseController.php L18–87) | NO (not in mobile lib; verified used-by = admin/manual tests) |
| 6.2 | Fetch causes / cause by id / my causes / follow / unfollow / categories | Campaigns | ACTIVE | `CauseController` L89–307 (`fetchCauses`, `fetchCauseById`, `followCause`, `unfollowCause`, `fetchMyCauses`, `fetchCategories`) | NO |
| 6.3 | Razorpay donation order create (INR, paise conversion, pending `donations` row) | Donations | ACTIVE — tested | `DonationController::createDonationOrder` (app/Http/Controllers/DonationController.php L39–123); keys from env `RAZORPAY_KEY_ID/SECRET` | NO |
| 6.4 | Razorpay payment verification (HMAC signature check; success → increment `posts.raised_amount`, sync charity card, transactional) | Donations | ACTIVE — tested | `DonationController::verifyDonation` (L133–219) | NO |
| 6.5 | Razorpay webhook (`payment.authorized|captured|failed`), signature-verified, **no middleware** | Donations | ACTIVE | `DonationController::handleWebhook` (L332–394); route api.php L211 | NO |
| 6.6 | Donation history — my donations (with `total_donated`), per-cause donations (`total_raised`, sorting) | Donations | ACTIVE | `fetchMyDonations` (L228), `fetchCauseDonations` (L270) | NO |
| 6.7 | Donation model scopes: `byUser`, `forCause`, `success`; aggregates `getTotalDonatedByUser`, `getTotalRaisedForCause` | Donations | ACTIVE | `app/Models/Donation.php` (scopes/methods used by DonationController) | NO |

## 7. Feed: Posts, Comments, Likes, Stories, Hashtags

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 7.1 | Add post (multi media), fetch feeds (random/latest via `Constants::RandomPosts/LatestPosts`), post by id/user, search, hashtag search | Other (social feed) | ACTIVE (mobile) | `PostController` (app/Http/Controllers/PostController.php): `addPost` L85, `fetchPosts` L159, `fetchPostByPostId` L1213, `searchPost` L945, `fetchPostsByHashtag` L1170, `searchPostByInterestId` L1053 | YES |
| 7.2 | Comments + comment likes (`comments`, `like_comments`) | Other (social) | ACTIVE (mobile) | `addComment` L220, `fetchComments` L294, `deleteComment` L330, `likeDislikeComment` L998 | YES |
| 7.3 | Post likes/dislikes with `reaction_type` (default `support`) | Other (social) | ACTIVE (mobile) | `likePost` L372, `dislikePost` L461, `fetchUsersWhoLikedPost` L849; migration `2026_06_28_000001_add_reaction_type_to_likes_table.php` | YES |
| 7.4 | Stories (24h media), view tracking, story replies via chat `messages.story_id` | Other (social) | ACTIVE (mobile) | `createStory` L695, `viewStory` L734, `fetchStory` L788, `fetchStoryByID` (route api.php), `deleteStory` L1417; migration `2026_06_24_130000_add_story_id_to_messages_table.php` | YES |
| 7.5 | Generic file upload endpoint (`uploadFile` → storage URL) | Other (media) | ACTIVE (mobile) | `PostController::uploadFile` (L824–844) | YES |
| 7.6 | Post restriction flags (admin hide/restrict) | Admin | ACTIVE (web) | `updatePostRestrictionStatus` (PostController.php L1479); `posts.restriction` handled in admin list | NO |
| 7.7 | Cause feed context fields on posts (`is_emergency`, `context_label`, `impact_label`, `community_label`) | Campaigns | ACTIVE (schema) | migration `2026_06_27_220400_add_feed_context_fields_to_posts_table.php` | Partial |

## 8. Reels (short video) & Music

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 8.1 | Upload reel, like/dislike reel, view count, reel comments, delete, save/fetch saved reels, explore feed, by-user, by-hashtag, by-music, by-interest, by-id, report | Other (social) | ACTIVE (mobile) | `ReelController` (app/Http/Controllers/ReelController.php): `uploadReel` L148, `likeDislikeReel` L193, `increaseReelViewCount` L274, `addReelComment` L300, `fetchReelComments` L364, `deleteReelComment` L402, `fetchReelsByUserId` L444, `fetchReelsOnExplore` L499, `deleteReel` L551, `searchReelsByInterestId` L606, `fetchReelsByHashtag` L669, `reportReel` L716, `fetchSavedReels` L756, `fetchReelById` L795 | YES |
| 8.2 | Music library — categories, search, saved music, by-category, reels by music | Other (social) | ACTIVE (mobile) | `fetchMusicWithSearch` L22, `fetchMusicCategories` L51, `fetchSavedMusic` L65, `fetchMusicByCategory` L90, `fetchReelsByMusic` L118 | YES |
| 8.3 | Reels linked to causes (`reels.cause_id` FK → posts) | Campaigns | ACTIVE (schema) | migration `2025_01_01_000003_add_cause_fields_to_reels_table.php` | NO |
| 8.4 | Admin music/category CRUD + reel moderation | Admin | ACTIVE (web) | `musics` L1321, `categoryList` L1329, `addCategory` L1379, `musicList` L1432, `addMusic` L1501, `deleteReelByAdmin` L1276, `reelReportList` L1044 | NO |

## 9. Rooms (group audio chat rooms)

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 9.1 | Room CRUD — create/edit/delete, my rooms, suggested, random, by-interest, list, detail, rooms I'm in | Other (social) | ACTIVE (mobile) | `RoomController` (app/Http/Controllers/RoomController.php): `createRoom` L21, `editRoom` L100, `deleteRoom` L1241, `fetchMyOwnRooms` L1284, `fetchRoomsByInterest` L1302, `fetchSuggestedRooms` L1346, `fetchRandomRooms` L1529, `fetchRoomsList` L1689, `fetchRoomDetail` L1148, `fetchRoomsIAmIn` L2298 | YES |
| 9.2 | Room membership lifecycle — invite, join-or-request, accept/reject invitation, accept/reject request, remove user, leave, co-admin make/remove, member list, admin list | Other (social) | ACTIVE (mobile) | `inviteUserToRoom` L144, `joinOrRequestRoom` L246, `acceptInvitation` L432, `rejectInvitation` L654, `acceptRoomRequest` L534, `rejectRoomRequest` L714, `fetchRoomRequestList` L769, `removeUserFromRoom` L840, `leaveThisRoom` L1083, `makeRoomAdmin` L1584, `removeAdminFromRoom` L1650, `fetchRoomUsersList` L799, `fetchRoomAdmins` L1623, `searchUserForInvitation` L1463, `getInvitationList` L403 | YES |
| 9.3 | Room notification mute | Other (social) | ACTIVE (mobile) | `muteUnmuteRoomNotification` (L2259) | YES |
| 9.4 | Room ↔ conversation link (each room gets a group `conversations` row for in-room chat) | Chat | ACTIVE | migrations `2026_06_24_160000_add_conversation_id_to_rooms_table.php`, `2026_06_24_170000_create_conversations_for_existing_rooms.php` | NO (indirect) |
| 9.5 | Agora RTC token builder (`RtcTokenBuilder`, RolePublisher, 7200s expiry) + token endpoint | Other (realtime) | ACTIVE (mobile) | `SettingsController::generateAgoraToken` (app/Http/Controllers/SettingsController.php L736–761); `app/Classes/AgoraDynamicKey/AccessToken.php`, `RtcTokenBuilder.php` | YES |

## 10. Chat (conversations & messages — V2 module)

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 10.1 | One-to-one & group conversations; unread counts per side; mute per user (JSON `muted_by`); clear/delete per user (JSON `cleared_at`); block-aware listing | Chat | ACTIVE (API, Sanctum-protected) — **not called by current Flutter lib** | `ChatController` (app/Http/Controllers/ChatController.php): `getConversations` L23, `createOrGetConversation` L395, `markAsRead` L474, `muteConversation` L698, `unmuteConversation` L759, `clearConversation` L801, `deleteConversation` L864; routes api.php L219–237 | NO (Postman collection `Chat_and_Notifications_API.postman_collection.json` covers it) |
| 10.2 | Send message — types 1–7 (text/image/video/audio/file/location/storyReply), media + thumbnail upload (20MB/2MB), reply threading, story replies | Chat | ACTIVE (API) | `ChatController::sendMessage` (L273–387) | NO |
| 10.3 | Realtime broadcast over websocket — `MessageSent` on channel `conversation.{id}`, event `message.sent`, `toOthers()` | Chat | ACTIVE | `app/Events/MessageSent.php`; `composer.json` `beyondcode/laravel-websockets`; `config/websockets.php` + `websockets_statistics_entries` table | NO |
| 10.4 | Message push notification to recipients | Chat | ACTIVE | `ChatController::sendMessageNotification` (called at ChatController.php L361) → `NotificationController`/FCM | NO |
| 10.5 | Legacy chatter schema (`database_chatter.sql`, db `empty_chatter`) — pre-V2 chat/community tables used by the feed features above | Other | ACTIVE (base schema) | `database_chatter.sql` (35 CREATE TABLE statements) | YES (these tables back the mobile endpoints) |

## 11. Audio Spaces (migrated from Firebase Firestore)

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 11.1 | Audio spaces CRUD + list (public + joined), UUID client-generated PK, Agora token column | Chat/Other | ACTIVE (API, Sanctum) — not called by Flutter lib | `AudioSpaceController` (app/Http/Controllers/AudioSpaceController.php): `getAudioSpaces` L22, `getAudioSpace` L105, `createAudioSpace` L186, `updateAudioSpace` L290, `deleteAudioSpace` L390; routes api.php L240–252 | NO |
| 11.2 | Participation — join, leave, participant types (admin/host/listener/requested/added/kicked_out), mic toggle, kick | Chat/Other | ACTIVE (API) | `joinAudioSpace` L445, `leaveAudioSpace` L516, `changeParticipantType` L571, `toggleParticipantMic` L646, `kickParticipant` L723 | NO |
| 11.3 | In-space chat messages | Chat/Other | ACTIVE (API) | `getMessages` L787, `sendMessage` L854; table `audio_space_messages` | NO |

## 12. Notifications (V2 push pipeline)

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 12.1 | Register device token (device_type 1=iOS→`apns_token`, 2=Android→`fcm_token`; keeps legacy `device_token`) | Notifications | ACTIVE (API) — not called by Flutter lib | `NotificationController::registerDeviceToken` (app/Http/Controllers/NotificationController.php L19–62); migration `2026_06_24_120004_update_users_for_push_notifications.php` | NO |
| 12.2 | Send push to single user — persists `push_notifications` row, FCM v1 HTTP call, status/sent tracking | Notifications | ACTIVE (API) | `sendToUser` (L65–160); table `push_notifications` | NO |
| 12.3 | Notification list / mark read / mark all read | Notifications | ACTIVE (API) | `getUserNotifications` L247, `markAsRead` L282, `markAllAsRead` L315 | NO |
| 12.4 | **FCM v1 via `google/apiclient` service account** — reads `googleCredentials.json` at project root, OAuth scope `firebase.messaging`, topic suffixes `_ios`/`_android`; **⚠ committed file is 0 bytes (empty placeholder)** | Notifications (integration) | PARTIAL — credentials file empty in repo | `app/Models/GlobalFunction.php::sendPushNotificationToAllUsers` (L19–107) and `::sendPushNotificationToUser` (L112–186); `googleCredentials.json` (0 bytes) | YES (mobile receives pushes via legacy topic/token flow) |
| 12.5 | Legacy "notify everyone" from admin panel (`admin_notifications` + FCM topic broadcast) | Notifications/Admin | ACTIVE (web) | `AdminController::sendNotification` (app/Http/Controllers/AdminController.php L72–90) | Indirect (users receive push) |
| 12.6 | Platform notification feed for app (admin-authored announcements) | Notifications | ACTIVE (mobile) | `AdminController::fetchPlatformNotification` (L212); route api.php L283 | YES |
| 12.7 | Direct FCM relay endpoint (mobile passes full FCM v1 payload; backend injects OAuth token) | Notifications | ACTIVE (mobile) | `SettingsController::pushNotificationToSingleUser` (SettingsController.php L701–733) | YES |

## 13. Admin panel (Blade web UI, session-auth)

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 13.1 | Admin login/logout/forgot password | Admin | ACTIVE | `LoginController` (app/Http/Controllers/LoginController.php L28–50); routes web.php L38–41 | NO |
| 13.2 | Dashboard + chart data (users/rooms/posts counts) | Reports | ACTIVE (web) | `SettingsController::index` (SettingsController.php L76), `fetchAllChartData` (L35) | NO |
| 13.3 | Users management — list, detail, verified lists, block/unblock, verify user, moderator toggle, avatar/profile delete | Admin | ACTIVE (web) | `UserController::userListWeb` (L34), `usersDetail` (L368), `verifyUser` (L378), `blockUserByAdmin` (L540), `unblockUserByAdmin` (L563), `updateModeratorStatus` (L1716), `moderatorsList` (L122) | NO |
| 13.4 | Moderation queues — reports on users/rooms/posts/reels with delete+block actions | Admin | ACTIVE (web) | `RoomController::reportList` (RoomController.php L898), `deleteReport` (L1036), `deleteReportWithRoom` (L1056); `PostController::reportPostList` (L510), `deletePostReport` (L1108), `deletePost` (L1128); `ReelController::reelReportList` (L1044); `UserController::userReportList` (L1004), `blockUserFromReport` (L1141) | NO |
| 13.5 | Moderation of posts/reels/stories/comments from admin (incl. modal comment views) | Admin | ACTIVE (web) | `PostController::allPostsList` (L1266), `fetchPostComment` (L1499), `deleteCommentFromAdmin` (L1533), `deleteStoryFromAdmin` (L1682), `allStoriesList` (L1703); `ReelController::userReelList` (L939) | NO |
| 13.6 | Interests CRUD | Admin/Settings | ACTIVE (web) | `InterestController` (app/Http/Controllers/InterestController.php L16–144) | NO (mobile only reads via `fetchInterests`) |
| 13.7 | FAQs + FAQ types CRUD | Admin/Settings | ACTIVE (web + mobile read) | `FAQsController` (app/Http/Controllers/FAQsController.php L11–250); mobile reads `fetchFAQs` | YES (read side) |
| 13.8 | Report reasons CRUD | Admin/Settings | ACTIVE (web) | `SettingsController::reportReasonList` (L343), `addreportReason` (L393), `updateReportReason` (L417), `deleteReportReasonType` (L445) | Partial (served via fetchSetting) |
| 13.9 | Username restrictions CRUD | Admin/Settings | ACTIVE (web) | `RestrictionController` (app/Http/Controllers/RestrictionController.php L12–146) | NO |
| 13.10 | App settings — app name, storage type, deep links (Android/iOS asset files), AdMob Android/iOS keys | Admin/Settings | ACTIVE (web) | `SettingsController::updateSettings` (L461), `androidDeepLinking` (L579), `iOSDeepLinking` (L613), `admob`/`admobAndroid`/`admobiOS` (routes web.php L166–169), `changeAppName` (routes web.php L110), `saveStorageSetting` (L141) | Indirect |
| 13.11 | Static pages — privacy policy, terms (CRUD `tbl_pages`) | Admin/Settings | ACTIVE | `PagesController` (app/Http/Controllers/PagesController.php L55–89); public read routes web.php L74–75 | Partial (mobile links to `termsOfUse`/`privacyPolicy` — `mobile/lib/utilities/const.dart` L7–8) |
| 13.12 | Rooms admin list/delete, privacy & join-request toggles, member tables | Admin | ACTIVE (web) | `RoomController::roomsListWeb` (L1720), `deleteThisRoom` (L2231), `updatePrivateStatus` (L1801), `updateJoinRequestStatus` (L1819), table views L1849–2231 | NO |
| 13.13 | Fake data generator (Faker users/posts/rooms) | Admin | DEAD_CODE-ish (utility; production risk) | `SettingsController::addFakeData` (L763) | NO |

## 14. Mobile app shared deep links / share pages

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 14.1 | Share-link landing page `GET /s/{shareLinkPage}` (post/profile share resolution) | Other | ACTIVE | `ShareLinkPageController` (app/Http/Controllers/ShareLinkPageController.php L15); route web.php L31 | YES |
| 14.2 | `/.well-known/apple-app-site-association` + `assetlinks.json` (universal links) | Other | ACTIVE | `routes/web.php` L33–54 | YES |

## 15. Infrastructure / cross-cutting

| # | Feature | Category | Status | Source references | Mobile-relevant |
|---|---|---|---|---|---|
| 15.1 | **File storage abstraction** — disk chosen from `settings.storage_type`: 1=S3 (`ITEM_BASE_URL`), 2=DigitalOcean Spaces (`DO_SPACE_URL`), else local `public/` disk; path pattern `{app}/uploads/{time}_{app}_{filename}` | Other (media) | ACTIVE | `GlobalFunction::saveFileAndGivePath` (app/Models/GlobalFunction.php L192–213), `deleteFile` (L166–190); `composer.json` `league/flysystem-aws-s3-v3` | YES (all media URLs served from here) |
| 15.2 | WebSocket server (beyondcode/laravel-websockets) + statistics counters | Chat (infra) | ACTIVE | `composer.json`; migration `0000_00_00_000000_create_websockets_statistics_entries_table.php`; `BroadcastServiceProvider` | NO |
| 15.3 | Scheduled tasks / cron | Other | **NONE** — `Console/Kernel::schedule` is empty (only commented `inspire`) | app/Console/Kernel.php L20–23 | NO |
| 15.4 | Queued jobs — `failed_jobs` table exists; **no job classes**; push/FCM calls are synchronous curl/Http | Other | PARTIAL (table only) | migration `2019_08_19_000000_create_failed_jobs_table.php`; `GlobalFunction.php` curl blocks | NO |
| 15.5 | Content moderation (SightEngine) — image/video/text check-workflow calls **from the mobile app directly**, not the PHP backend | Other (integration) | ACTIVE on mobile side | `mobile/lib/common/api_service/sight_engine_service.dart` (L28, L79, L117) | YES (external dependency to preserve in migration) |
| 15.6 | Role model — no RBAC. `users.is_moderator` (1/0) checked **inline per endpoint**; `users.is_block`; API-admin routes use `IsAdmin` middleware that grants admin if `user.id==1` OR `user_name == user.email` in `admins` table (**hard-coded ID-1 backdoor**) | Admin (authz) | PARTIAL / risk | `UserController::deletePostByModerator` (UserController.php L1743–1764, `is_moderator !== Constants::moderator`); `app/Http/Middleware/IsAdmin.php` | Partial |
| 15.7 | Sanctum personal access tokens (`personal_access_tokens`), 7-day expiry set at issuance (config `sanctum.expiration=null` — expiry enforced only via token `expires_at`) | Auth | ACTIVE | migrations `2019_12_14_000001_create_personal_access_tokens_table.php`; `AuthController` token creation; `config/sanctum.php` | NO |
| 15.8 | Test/debug endpoints — `POST /api/test` (`PostController::test` L1788) | Other | DEAD_CODE (dev leftover) | routes/api.php L356 | NO |

---

## Feature count summary

- Documented features: **60** across 15 groups.
- ACTIVE: 47 · PARTIAL: 7 · DEAD_CODE/utility: 3 · NONE (absent): scheduled jobs, queued jobs, true RBAC, beneficiary module, reports/exports beyond dashboard counts, Stripe/UPI payment methods (enum placeholders only — `donations.payment_method` enum has `stripe|upi` but only Razorpay is implemented, `DonationController.php` L39–123).

## Top migration-relevant notes

1. The Flutter app is still entirely on the **legacy endpoint family** (97 endpoints, apikey header only) — see `LEGACY_API_INVENTORY.md` §"used-by".
2. The V2 modules (Sanctum auth, Chat, Notifications, Audio Spaces, Charity Profile V2, Volunteer workflow, Causes/Donations) are Sanctum/`AuthorizeUser`-protected and are exercised by the Postman collection + shell test scripts, **not by the shipped Flutter lib**.
3. New backend has **no equivalents** for feed/rooms/reels/stories/chat/audio-spaces/charity-gamification tables (see `LEGACY_DATABASE_MAPPING.md`) — feature parity decisions must be explicit (port vs. drop).
