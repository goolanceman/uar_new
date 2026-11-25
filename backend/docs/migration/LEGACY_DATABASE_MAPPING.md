# Legacy Database Mapping — UAR Legacy MySQL → New Prisma/PostgreSQL

**Legacy schema sources (READ-ONLY audit):**
- `database_chatter.sql` — full phpMyAdmin dump of DB `empty_chatter` (35 `CREATE TABLE` statements; base schema for the community app).
- `database/migrations/*.php` — 57 migrations (Laravel 9), including the 2026-06 V2 charity/chat modules.
- Model→table bindings verified in `app/Models/*` (`public $table` declarations).

**New schema source:** `/Users/mansoorkhan/Documents/works/uar/uarnew/backend/prisma/schema.prisma` — **69 models**, all mapped with `@@map` snake_case table names.

**New backend auth context (relevant to mapping):** `User.role` = `ADMIN | VOLUNTEER | DONOR | BENEFICIARY | DOCTOR | NURSE | PHARMACIST | LAB_TECH | HOSPITAL` (`schema.prisma` L17–22); sessions are cookie-based (`src/lib/session.ts`), not token-table-based.

---

## Mapping key

| Legacy table | Owning model(s) | Read/written by (main endpoints) | New Prisma equivalent |
|---|---|---|---|
| `users` | `App\Models\User` (app/Models/User.php) | `/addUser`, `/editProfile`, `/auth/*`, `/fetchProfile`, moderator checks, every `user_id`-param endpoint | **`User`** (schema.prisma L16–42, table `users`) — see notes N1 |
| `admins` | `App\Models\Admin` | `LoginController::checklogin` (web panel), `IsAdmin` middleware email match | **`User` role=ADMIN** (partial; no separate admins table — password/session mechanics differ, see N2) |
| `password_resets` | (DB::table in `AuthController::forgotPassword` L196, `resetPassword` L240) | `/auth/forgot-password`, `/auth/reset-password`, `/auth/send-verification-otp`, `/auth/verify-email` | **NONE IN NEW SCHEMA** (new auth uses its own flow; no OTP tables) |
| `personal_access_tokens` | Laravel Sanctum | all `AuthorizeUser`-protected endpoints | **NONE IN NEW SCHEMA** (replaced by cookie sessions, `src/lib/session.ts`) |
| `failed_jobs` | Laravel queue infra | none (no queued jobs in code) | **NONE IN NEW SCHEMA** |
| `following_lists` | `App\Models\FollowingList` | `/followUser`, `/unfollowUser`, `/fetchFollowingList`, `/fetchFollowersList` | **NONE IN NEW SCHEMA** |
| `posts` | `App\Models\Post` (+ scopes `scopeCauses` L120, `scopeActive` L136) | `/addPost`, `/fetchPosts`, cause endpoints (`createCause` etc.), donation target (`donations.cause_id` → posts) | **Partial: `Campaign`** (schema.prisma L128–173, `campaigns`) for `type='cause'` rows — see N3. **NONE IN NEW SCHEMA** for normal social posts |
| `post_contents` | `App\Models\PostContent` | post create/fetch (media arrays) | **NONE IN NEW SCHEMA** (nearest: `Campaign.images/gallery` JSON strings; `FileAsset` for uploads) |
| `comments` | `App\Models\Comment` | `/addComment`, `/fetchComments`, `/deleteComment` | **NONE IN NEW SCHEMA** |
| `likes` (+ `reaction_type`) | `App\Models\Like` | `/likePost`, `/dislikePost`, `/likeDislikeReel` | **NONE IN NEW SCHEMA** |
| `like_comments` | `App\Models\LikeComment` | `/likeDislikeComment` | **NONE IN NEW SCHEMA** |
| `stories` | `App\Models\Story` | `/createStory`, `/fetchStory`, `/viewStory`, `/deleteStory`; chat `messages.story_id` | **NONE IN NEW SCHEMA** |
| `reels` (+ `cause_id`) | `App\Models\Reel` | all `/uploadReel`, `/fetchReels*` endpoints | **NONE IN NEW SCHEMA** |
| `reel_comments` | `App\Models\ReelComment` | `/addReelComment`, `/fetchReelComments` | **NONE IN NEW SCHEMA** |
| `musics` | `App\Models\Music` | `/fetchMusicWithSearch`, `/fetchMusicByCategory`, `/fetchReelsByMusic` | **NONE IN NEW SCHEMA** |
| `music_categories` | `App\Models\MusicCategory` | `/fetchMusicCategories`; admin CRUD | **NONE IN NEW SCHEMA** (nearest: `Master`) |
| `interests` | `App\Models\Interest` | `/fetchInterests`, `fetchSetting`, room `interest_ids` | **NONE IN NEW SCHEMA** (nearest: `Master` category-tagged values, schema.prisma L430–440) |
| `rooms` (+ `conversation_id`) | `App\Models\Room` | all room endpoints (16+), admin `roomsListWeb` | **NONE IN NEW SCHEMA** |
| `room_users` | `App\Models\RoomUser` (`type`: 1 request, 2 member, 3 co-admin, 4 invited, 5 admin) | join/invite/accept/admin endpoints | **NONE IN NEW SCHEMA** |
| `reports` | `App\Models\Report` | `/reportUser`, `/reportPost`, `/reportReel`, `/reportRoom`; admin report queues | **NONE IN NEW SCHEMA** (nearest moderation-ish: `ActivityLog`, `ContactQuery` — neither is a moderation queue) |
| `report_reasons` | `App\Models\ReportReason` | `fetchSetting`, admin CRUD | **NONE IN NEW SCHEMA** (nearest: `Master`) |
| `saved_notifications` | `App\Models\SavedNotification` (relations user/post/room/reel) | generated on follow/like/comment/invite; read by `/fetchUserNotification` | **Partial: `Notification`** (schema.prisma L1065–1080, `notifications`) — generic per-user notification; legacy polymorphic post/room/reel payloads have no equivalent |
| `user_notifications` | `App\Models\UserNotification` (migration `2023_03_23_114601`) | legacy push-log table | **`Notification`** (nearest) |
| `admin_notifications` | `App\Models\AdminNotification` | `AdminController::sendNotification/fetchPlatformNotification` (broadcasts + app feed) | **NONE IN NEW SCHEMA** (nearest: `Notification` type=SYSTEM broadcast) |
| `push_notifications` | `App\Models\PushNotification` | `/notifications/send`, `/notifications/list`, read endpoints | **Partial: `Notification`** — legacy delivery-tracking fields (`status`, `sent_at`, `platform`, `device_token`, `error_message`) have no equivalent columns |
| `settings` | `App\Models\Setting` (+ `GlobalFunction::saveFileAndGivePath` reads `storage_type`) | `fetchSetting`, admin `updateSettings`, storage selection | **`Setting`** (schema.prisma L1102–1110, `settings`) — ⚠ shape differs: legacy is a **single wide row** (app_name, storage_type, admob keys, push topic, room limits…); new is **key/value rows** with `isSecret`. See N4 |
| `document_types` | `App\Models\DocumentType` | `fetchSetting`, admin CRUD, profile verification | **NONE IN NEW SCHEMA** (nearest: `Master`) |
| `username_restrictions` | `App\Models\UsernameRestriction` | `checkUsername`, admin CRUD | **NONE IN NEW SCHEMA** |
| `faqs` / `faqs_types` | `App\Models\FAQs`, `App\Models\FAQsType` | `/fetchFAQs`, admin CRUD | **NONE IN NEW SCHEMA** |
| `tbl_pages` | `App\Models\Pages` | privacy/terms admin CRUD; public `privacyPolicy`, `termsOfUse` | **NONE IN NEW SCHEMA** |
| `profile_verifications` | `App\Models\ProfileVerification` | `/profileVerification`; admin approve/reject | **NONE IN NEW SCHEMA** (nearest: `FileAsset` for the uploaded docs; verification state lives ad-hoc on domain models) |
| `donations` | `App\Models\Donation` (scopes `byUser`, `forCause`, `success`; `getTotalDonatedByUser`, `getTotalRaisedForCause`) | `/createDonationOrder`, `/verifyDonation`, `/fetchMyDonations`, `/fetchCauseDonations`, Razorpay webhook | **`Donation`** (schema.prisma L81–125, `donations`) — see N5 |
| `cause_categories` | `App\Models\CauseCategory` | `/fetchCauseCategories`, `createCause` | **NONE IN NEW SCHEMA** (folded into `Campaign.category` string enum) |
| `cause_followers` | `App\Models\CauseFollower` (unique user+cause) | `/followCause`, `/unfollowCause`, `/fetchMyCauses` | **NONE IN NEW SCHEMA** |
| `charity_cards` | `App\Models\CharityCard` (`generateCardNumber` L117–124) | `/charity/card/*`, `/charity/impact`; `CharityCardService::syncCardStats` | **NONE IN NEW SCHEMA** |
| `donation_points` | `App\Models\DonationPoint` | `/charity/points/*` | **NONE IN NEW SCHEMA** |
| `achievements` / `user_achievements` | `App\Models\Achievement`, `App\Models\UserAchievement` | `/charity/achievements/*` | **NONE IN NEW SCHEMA** |
| `donation_goals` | `App\Models\DonationGoal` | `/charity/goals/*` | **NONE IN NEW SCHEMA** (semantically nearest: `RecurringNeed`, but that is beneficiary-side) |
| `charity_events` | `App\Models\CharityEvent` | `/charity/events/*` | **NONE IN NEW SCHEMA** (new `Event`-family models are domain-specific: `FoodEvent`, `CorridorEvent`, `MedicalCamp`) |
| `event_participants` | `App\Models\EventParticipant` (unique event+user, QR check-in) | `/charity/events/register`, `/check-in`, `/my-events`, `/cancel` | **NONE IN NEW SCHEMA** (nearest: `CampRegistration` / `FoodRegistration`) |
| `volunteer_applications` | `App\Models\VolunteerApplication` | `/volunteer/apply`, `/volunteer/status`, `/admin/volunteer/*`, admin web | **`VolunteerApplication`** (schema.prisma L367–385, `volunteer_applications`) — see N6 |
| `conversations` (+ `muted_by`, `cleared_at` JSON) | `App\Models\Conversation` (`getOtherUser`, `updateLastMessage`) | `/chat/conversations*` | **NONE IN NEW SCHEMA** |
| `messages` (+ `story_id`, `location_data` JSON, status/deleted flags) | `App\Models\Message` | `/chat/messages`, `ChatController::getMessages`; broadcast via `MessageSent` event | **NONE IN NEW SCHEMA** |
| `conversation_participants` | `App\Models\ConversationParticipant` | group chat membership/read-state | **NONE IN NEW SCHEMA** |
| `audio_spaces` | `App\Models\AudioSpace` (client-UUID string PK) | `/audio-spaces*` | **NONE IN NEW SCHEMA** |
| `audio_space_participants` | `App\Models\AudioSpaceParticipant` | join/leave/type/mic/kick | **NONE IN NEW SCHEMA** |
| `audio_space_messages` | `App\Models\AudioSpaceMessage` (client microseconds-string PK) | `/audio-spaces/{id}/messages` | **NONE IN NEW SCHEMA** |
| `websockets_statistics_entries` | beyondcode/laravel-websockets package | websocket server stats | **NONE IN NEW SCHEMA** (new backend has no websocket server; nearest: `src/routes/events.ts` SSE stream for donation feed) |
| `migrations` | Laravel framework | — | n/a (Prisma `_prisma_migrations`) |

---

## Detailed legacy columns (verified from migrations + dump)

### `users` (migrations `2014_10_12_000000`, `2026_06_24_100000`, `2026_06_24_120004`, `2026_06_24_180000`, `2026_06_25_090511`)
`id`, `identity` (login id, unique), `email` (unique, nullable), `username` (unique), `full_name`, `password` (nullable; bcrypt via `setPasswordAttribute` mutator, User.php L124–129), `email_verified_at`, `bio`, `interests` (CSV), `profile` (avatar URL), `following`, `followers` (denormalized counters), `login_type` (int), `device_type` (0=Android, 1=iOS per `Constants::android/iOS`), `onesignal_player_id`, `device_token`, `fcm_token`, `apns_token`, `notification_preferences` (JSON), `last_active_at`, `is_block`, `is_verified` (0/1/2/3), `is_moderator`, `block_user_ids` (CSV), `user_type` (enum supporter|volunteer, nullable), `volunteer_status` (enum pending|approved|rejected), `volunteer_requested_at`, `volunteer_approved_at`, `volunteer_approved_by` →users.id (SET NULL), `volunteer_rejection_reason`, `total_points`, `lifetime_donated`, `impact_score`, `current_tier` (bronze/silver/gold/platinum), `member_since`, `remember_token`, timestamps.
**FKs:** `volunteer_approved_by` → users.

**→ New `User`:** keeps `email`, `password`, `name`, plus role/status; **loses** identity-login, social counters, moderator flag, block list, device tokens, charity denormalizations. Mobile-relevant fields (`identity` login, `is_moderator`, `block_user_ids`, `device_token`) have **no home** — must be added or re-modeled if the feed app migrates.

### `posts` (migrations `2023_03_15_062628`, `2026_06_24_000001`, `2026_06_27_220400`)
`id`, `user_id` →users, `desc`, `comments_count`, `likes_count`, `type` (enum normal|cause), `goal_amount` (10,2), `raised_amount` (10,2, default 0), `deadline` (date), `is_verified` (bool, admin-verified causes), `category_id` →cause_categories, `is_emergency`, `context_label`, `impact_label`, `community_label`, restriction flag (admin), timestamps.
**FKs:** user_id → users; category_id → cause_categories.

**→ `Campaign`** matches the cause subset well (`title`, `targetAmount`, `raisedAmount`, `endDate`, `status`, `category`, `coverImage`, `urgent` ≈ `is_emergency`) but **cannot** represent normal posts, comments or likes.

### `donations` (migration `2026_06_24_000002`)
`id`, `user_id` →users (CASCADE), `cause_id` →posts (CASCADE), `amount` (10,2), `payment_id`, `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`, `payment_method` (enum razorpay|stripe|upi), `type` (enum one_time|recurring), `status` (enum pending|success|failed), `notes`, indexes user_id/cause_id/status/created_at.
**→ New `Donation`:** has `gatewayOrderId`/`transactionId`/`paymentStatus`/`paymentMethod`/`campaignId` ≈ order id/payment id/status/method/cause. **Missing:** razorpay signature column (only stored implicitly), and legacy writes `posts.raised_amount` increment + `CharityCardService::syncCardStats` after success (`DonationController::verifyDonation` L168–180) — new backend increments `Campaign.raisedAmount` only if wired in `donations.ts`.

### `volunteer_applications` (migrations `2026_06_24_180001`, `2026_06_24_180002`)
`id`, `user_id` →users (CASCADE), `skills` (JSON), `custom_skills` (JSON), `availability` (JSON), `is_flexible`, `city`, `state`, `country` (default USA), `postal_code`, `latitude` (10,8), `longitude` (11,8), `service_areas` (JSON), `willing_to_travel`, `max_travel_distance` (miles), `remote_volunteering`, `motivation`, `prior_experience`, `emergency_contact`, `emergency_phone`, `address_line1`, `address_line2`, `status` (pending|approved|rejected), `reviewed_by` →users (SET NULL), `reviewed_at`, `rejection_reason`, `admin_notes`.
**→ New `VolunteerApplication`:** keeps `userId`, `skills`, `availability`, `motivation`, `status` (PENDING|APPROVED|REJECTED), `reviewNote`, `reviewedAt` — **loses** address/geo/emergency/travel fields (those live on new `Volunteer`: `assignedArea`, `emergencyContact`, `idProof`).

### `conversations` (migrations `2026_06_24_120000`, `2026_06_24_140000`)
`id`, `type` (1 direct, 2 group), `user_1_id`/`user_2_id` →users (CASCADE), `group_name`, `group_photo`, `admin_id` →users (SET NULL), `last_message`, `last_message_at`, `last_message_user_id`, `user_1_unread_count`, `user_2_unread_count`, `is_archived`, `muted_by` (JSON), `cleared_at` (JSON). → **NONE IN NEW SCHEMA.**

### `messages` (migrations `2026_06_24_120001`, `2026_06_24_130000`)
`id`, `conversation_id` →conversations (CASCADE), `sender_id` →users (CASCADE), `message`, `type` (1 text, 2 image, 3 video, 4 audio, 5 file, 6 location; 7 = story reply), `media_url`, `thumbnail_url`, `file_name`, `file_size`, `mime_type`, `location_data` (JSON), `reply_to_message_id` →messages (SET NULL), `story_id` →stories, `is_read`, `read_at`, `status` (1 sent, 2 delivered, 3 read, 4 failed), `is_deleted`, `is_edited`, `edited_at`. → **NONE IN NEW SCHEMA.**

### `push_notifications` (migration `2026_06_24_120003`)
`id`, `user_id` →users (CASCADE), `title`, `body`, `type` (message/like/comment/follow/room_invite…), `data` (JSON), `status` (1 pending, 2 sent, 3 delivered, 4 failed, 5 clicked), `sent_at`, `delivered_at`, `clicked_at`, `platform`, `device_token`, `error_message`, `is_read`, `read_at`. → **nearest `Notification`** (no delivery-tracking columns).

### `settings` (migration `2023_03_21_113113` + dump)
Single-row table consumed app-wide: `storage_type` (1 S3 / 2 DigitalOcean / 0 local), app name, deep-link settings, AdMob ids, notification topic (`NOTIFICATION_TOPIC` env + `_ios`/`_android` suffixes in `GlobalFunction.php` L40/L73), `setRoomUsersLimit` (used by `fetchSetting` L201), etc. → new **`Setting`** key/value rows (`isSecret` masking) can carry the same values but every consumer changes shape.

### `rooms` (migrations `2023_03_15_103222`, `2026_06_24_160000`)
`id`, `conversation_id` →conversations (SET NULL), `admin_id` →users, `photo`, `title`, `desc` (900), `interest_ids` (CSV), `is_private`, `is_join_request_enable`, `total_member`. `room_users`: `room_id`, `user_id`, `invited_by`, `type` (1 join-request, 2 member, 3 co-admin, 4 invited, 5 admin), `is_mute`; unique(room_id,user_id). → **NONE IN NEW SCHEMA.**

### `reports` (migration `2023_03_20_073418`)
`id`, `room_id`, `user_id`, `reason`, `desc`; extended in code to also hold post/reel/user reports (`type` values, see `UserController::deletePostByModerator` deleting `Report::where('type',1)`). → **NONE IN NEW SCHEMA.**

### `achievements` / `user_achievements` (`2026_06_25_090502`, `2026_06_25_090504`)
Catalog: `name`, `slug`, `description`, `icon_url`, `category` (donation|engagement|impact|milestone|special), `tier` (bronze…diamond), `points_required`, `amount_required`, `count_required`, `reward_points`, `is_active`. Junction: unique(user,achievement), `unlocked_at`, `progress`, `is_claimed`, `claimed_at`. → **NONE IN NEW SCHEMA.**

### `charity_cards` (`2026_06_25_090459`)
`user_id` (unique) →users, `card_number` (unique, `CHR-…`), `member_name`, `membership_level` (bronze/silver/gold/platinum), `total_donated` (15,2), `donation_points`, `impact_score`, `member_since`, `valid_until`, `qr_code`, `is_active`. → **NONE IN NEW SCHEMA.**

### `donation_points` (`2026_06_25_090500`)
`user_id` →users, `donation_id` →donations (SET NULL), `points`, `type` (earned|redeemed|bonus|expired|adjustment), `description`, `expires_at`, `is_expired`. → **NONE IN NEW SCHEMA.**

### `donation_goals` (`2026_06_25_090506`)
`user_id`, `title`, `description`, `target_amount`, `current_amount`, `start_date`, `end_date`, `frequency` (one_time|monthly|yearly), `status` (active|completed|cancelled|expired), `is_public`, `completed_at`. → **NONE IN NEW SCHEMA.**

### `charity_events` / `event_participants` (`2026_06_25_090507`, `2026_06_25_090510`)
Events: `title`, `description`, `location`, `image_url`, `start_datetime`, `end_datetime`, `max_participants`, `current_participants`, `type` (fundraiser|volunteer|awareness|community|workshop), `status` (upcoming|ongoing|completed|cancelled), `requires_registration`, `requires_qr_checkin`, `points_reward`. Participants: unique(event,user), `status` (registered|confirmed|attended|cancelled|no_show), `registered_at`, `checked_in_at`, `qr_code`, `points_awarded`, `notes`. → **NONE IN NEW SCHEMA.**

### `audio_spaces` / `audio_space_participants` / `audio_space_messages` (`2026_06_24_150000–150002`)
Spaces: string UUID PK (client-generated), `title`, `description`, `topics` (CSV), `type` (public|private), `agora_token` (512), `is_active`, `ended_at`. Participants: unique(space,user), `type` (admin|host|listener|requested|added|kicked_out), `mic_status` (on|muted), `is_left`, `joined_at`, `left_at`. Messages: string PK (client microseconds), `audio_space_id`, `user_id`, `content`. → **NONE IN NEW SCHEMA.**

---

## Business rules worth carrying over (model-method level)

1. **Charity card economics** (`app/Services/CharityCardService.php`): 2 points per ₹1 donated; impact multiplier 1.0/1.25/1.5/2.0 at 10/25/50 donations; tiers by points — silver ≥500, gold ≥2500, platinum ≥10000. Synced transactionally after each successful donation and via `charity:sync-cards`.
2. **Raised-amount invariant:** `posts.raised_amount` only incremented on signature-verified success (`DonationController::verifyDonation` L168–180) or webhook `payment.authorized|captured` (L357–374); webhook can also fail a donation (`payment.failed`).
3. **Volunteer approval side-effects** (`VolunteerApplicationController::approve` L212+): application approved ⇔ `users.user_type='volunteer'` + `volunteer_status='approved'` + `volunteer_approved_at/by` set + push sent.
4. **Cause verification:** created causes are `is_verified=0` until admin verifies (`CauseController::createCause` L49; verified via admin web, there is no API verify route).
5. **Notification counter semantics:** `saved_notifications` rows created on follow/comment/like/invite; read via `/fetchUserNotification` with `start/limit` paging (UserController.php L1687–1713).
6. **Chat unread accounting:** per-side counters on `conversations.user_1/2_unread_count` + per-participant `unread_count`, reset by `markAsRead` (ChatController.php L474+); mute/clear state per-user in JSON columns.
7. **Block propagation:** block list stored as CSV on `users.block_user_ids`; chat listing computes `i_blocked`/`i_am_blocked` on the fly (ChatController.php L57–71).

## Risks / gaps summary for Agent 3

- **R1.** 20 legacy tables have **no new-schema equivalent** (all social feed, chat, audio spaces, rooms, reels/music, moderation, gamification). If mobile parity is required, Agent 3 must add ~15+ Prisma models or an explicit scope cut must be documented.
- **R2.** `Setting` shape mismatch (wide row vs key/value) — `fetchSetting` response composition must be rebuilt.
- **R3.** `users` loses legacy login identity (`identity`/`login_type`), moderator flag, block list — new `User` needs extension for mobile parity.
- **R4.** New `VolunteerApplication` drops geo/address/emergency fields collected by mobile-relevant legacy API (validation list in `VolunteerApplicationController::apply` L17–40).
- **R5.** Razorpay signature storage + webhook secret handling must be mapped onto `Donation.gatewayOrderId/transactionId` (no signature column today).
- **R6.** `personal_access_tokens` → cookie session migration changes mobile token handling completely (mobile currently sends no auth token at all).
