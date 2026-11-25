# Legacy API Inventory — UAR Legacy PHP Backend

**Source:** `routes/api.php` (356 lines, **187 HTTP endpoints**) + `routes/web.php` (**133 web routes**, admin Blade panel).
**Base URL (tests/mobile):** `http://localhost:8080/api` (Postman collection `Chat_and_Notifications_API.postman_collection.json`; `test_apis.sh`; mobile `lib/utilities/const.dart` L4–6: `baseURL = "http://192.168.1.4:8080/"`, `apiURL = baseURL + "api/"`).

## Global auth model

| Layer | Mechanism | Source |
|---|---|---|
| **API key gate** | Every API route (except Razorpay webhook) requires header `apikey: <fixed value>`; value compared to hard-coded constant in `app/Http/Middleware/CheckHeader.php` | `app/Http/Middleware/CheckHeader.php`; registered as `checkHeader` in `app/Http/Kernel.php` L63 |
| **User token** | Header `authtoken: <Sanctum token>` → rewritten to `Authorization: Bearer` → `auth('sanctum')->user()` | `app/Http/Middleware/AuthorizeUser.php`; registered as `authorizeUser` |
| **Admin role** | `IsAdmin` middleware: grants if `$user->id == 1` **or** `admins.user_name == user->email` | `app/Http/Middleware/IsAdmin.php` |
| **Moderator "role"** | No middleware. Each Moderator/* endpoint re-checks `users.is_moderator == 1` inline from request param `user_id` | e.g. `UserController::deletePostByModerator` (UserController.php L1743–1764) |
| **Web panel** | PHP session; `CheckLogin` middleware checks `Session::get('user_name')` | `app/Http/Middleware/CheckLogin.php`; `LoginController::checklogin` |

**⚠ Critical gap:** the legacy endpoints the Flutter app actually calls (§ modules 4–10 below) are protected by **`checkHeader` ONLY — no user authentication**. Callers pass `my_user_id`/`user_id` body params and the controller trusts them (e.g. `UserController::fetchProfile` L1216, `DonationController::createDonationOrder` L47 `user_id => required|exists`). Only the V2 modules (auth, chat, notifications, audio-spaces, volunteer, charity) use Sanctum.

**Response envelope (legacy):** `{"status": bool, "message": string, "data": mixed}` via `GlobalFunction::sendDataResponse/sendSimpleResponse` (`app/Models/GlobalFunction.php` L246–259). V2 controllers return the same shape with HTTP status codes.

**used-by legend:** `📱 mobile` = endpoint constant exists in Flutter lib (`mobile/lib/utilities/web_service.dart` + `mobile/lib/common/api_service/*`; 97 unique URLs). `🧪 tests` = exercised by `test_apis.sh` / `test_charity_apis.sh` / `API_TEST_RESULTS.md` / `test_chat_complex_scenarios.sh` / `test_websocket_broadcast.sh`. `📮 Postman` = in `Chat_and_Notifications_API.postman_collection.json`. `🖥 web` = admin Blade panel. `—` = route defined but no consumer found.

---

## 1. Authentication (`/api/auth/*`) — Sanctum V2 stack

Routes: `routes/api.php` L47–65. Public = 6; protected (checkHeader+AuthorizeUser) = 4.

| METHOD | Path | Controller@method | Auth | Roles | Request fields | Response summary | used-by |
|---|---|---|---|---|---|---|---|
| POST | /auth/register | AuthController@register (AuthController.php L24) | apikey | — (public) | `name`, `email` (unique), `password` (min 8), `device_token?`, `device_type?` | `data:{user, token, expires_at(+7d)}` | — |
| POST | /auth/login | AuthController@login (L81) | apikey | — | `email`, `password`, `device_token?` | `data:{user, token, expires_at}`; revokes prior tokens | 🧪 (test_apis.sh L16) |
| POST | /auth/forgot-password | AuthController@forgotPassword (L185) | apikey | — | `email` | `data:{otp}` (**OTP returned in response — TODO email**) | — |
| POST | /auth/reset-password | AuthController@resetPassword (L225) | apikey | — | `email`, `otp` (6), `password` (min 6) | status message; revokes tokens | — |
| POST | /auth/send-verification-otp | AuthController@sendVerificationOTP (L284) | apikey | — | `email` | `data:{otp}` | — |
| POST | /auth/verify-email | AuthController@verifyEmail (L317) | apikey | — | `email`, `otp` | `data:{user}` with `email_verified_at` | — |
| POST | /auth/logout | AuthController@logout (L122) | apikey+token | any | — | status message | 📮 |
| POST | /auth/refresh | AuthController@refresh (L141) | apikey+token | any | — | `data:{token, expires_at}` | — |
| GET | /auth/me | AuthController@me (L162) | apikey+token | any | — | `data:{user}` | 📮 |
| POST | /auth/delete-account | AuthController@deleteAccount (L388) | apikey+token | any | `password?` (optional confirm) | status message | — |

## 2. Legacy login (no token issued)

| METHOD | Path | Controller@method | Auth | Roles | Request fields | Response summary | used-by |
|---|---|---|---|---|---|---|---|
| POST | /addUser | UserController@addUser (L618) | apikey only | — | `identity` (email/social id), `login_type`, `device_type`, `device_token`, `full_name?` | find-or-create by identity; `data:{user}`; status false if exists | 📱 (login) |
| POST | /logOut | UserController@logOut (L1489) | apikey only | — | `my_user_id` | clears device_token | 📱 |
| POST | /deleteUser | UserController@deleteUser (L1300) | apikey only | — | `my_user_id` | deletes user + related rows | 📱 |

## 3. Push notifications V2 (`/api/notifications/*`)

Routes api.php L215–224 (checkHeader+AuthorizeUser). Source: `NotificationController`.

| METHOD | Path | Controller@method | Auth | Roles | Request fields | Response summary | used-by |
|---|---|---|---|---|---|---|---|
| POST | /notifications/register-token | registerDeviceToken (L19) | apikey+token | any | `device_type` (1=iOS, 2=Android), `device_token` | writes `users.apns_token`/`fcm_token` | 📮 🧪 |
| POST | /notifications/send | sendToUser (L65) | apikey+token | any | `user_id`, `title`, `body`, `data?{}`, `notification_type?`, `entity_type?`, `entity_id?` | persists `push_notifications`, FCM v1 send, `status`/`message_id` | 📮 🧪 |
| GET | /notifications/list | getUserNotifications (L247) | apikey+token | any | — | `data:[push_notifications]` | 📮 🧪 |
| POST | /notifications/{notificationId}/read | markAsRead (L282) | apikey+token | any | — | status message | 📮 |
| POST | /notifications/read-all | markAllAsRead (L315) | apikey+token | any | — | status message | 📮 |

## 4. Chat (`/api/chat/*`) — Sanctum

Routes api.php L226–240. Source: `ChatController.php`. Full contract in Postman collection §Chat.

| METHOD | Path | Controller@method | Auth | Roles | Request fields | Response summary | used-by |
|---|---|---|---|---|---|---|---|
| GET | /chat/conversations | getConversations (L23) | apikey+token | any | — | `data:[{id,type(1\|2),title,profile_image,last_message,last_message_at,unread_count,is_muted,i_blocked,i_am_blocked,other_user{…},admin_id,participants_count,room_id}]` | 📮 🧪 |
| GET | /chat/conversations/{conversationId}/messages | getMessages (L156) | apikey+token | member | query `limit` (≤100), `before_message_id?` | `data:[messages]` (id, conversation_id, sender_id, message, type 1–7, media_url, thumbnail_url, reply_to_message_id, story_id, created_at) | 📮 🧪 |
| POST | /chat/messages | sendMessage (L273) | apikey+token | member | JSON: `conversation_id`, `message`, `type` (1–7), `reply_to_message_id?`, `story_id?`; multipart: `media?` (≤20MB), `thumbnail?` (≤2MB) | `data:{message}`; broadcasts `MessageSent` (`message.sent` on `conversation.{id}`) + push | 📮 🧪 |
| POST | /chat/conversations | createOrGetConversation (L395) | apikey+token | any | `other_user_id` | `data:{conversation}` (type 1) | 📮 🧪 |
| POST | /chat/conversations/{id}/read | markAsRead (L474) | apikey+token | member | — | resets unread counters | 📮 |
| POST | /chat/conversations/{id}/mute | muteConversation (L698) | apikey+token | member | — | sets `muted_by.{userId}=true` | — |
| POST | /chat/conversations/{id}/unmute | unmuteConversation (L759) | apikey+token | member | — | clears mute | — |
| POST | /chat/conversations/{id}/clear | clearConversation (L801) | apikey+token | member | — | sets `cleared_at.{userId}` | 🧪 |
| DELETE | /chat/conversations/{id} | deleteConversation (L864) | apikey+token | member | — | hides conversation for user | 🧪 |

## 5. Audio Spaces (`/api/audio-spaces/*`) — Sanctum

Routes api.php L245–275. Source: `AudioSpaceController.php`.

| METHOD | Path | Controller@method | Auth | Roles | Request fields | Response summary | used-by |
|---|---|---|---|---|---|---|---|
| GET | /audio-spaces | getAudioSpaces (L22) | apikey+token | any | — | public + joined spaces with participants | 🧪 |
| GET | /audio-spaces/{id} | getAudioSpace (L105) | apikey+token | any | — | space + participants + messages refs | — |
| POST | /audio-spaces | createAudioSpace (L186) | apikey+token | any | client-UUID `id`, `title?`, `description?`, `topics?`, `type` (public/private) | creates space + host participant | 🧪 |
| PUT | /audio-spaces/{id} | updateAudioSpace (L290) | apikey+token | host/admin | partial space fields | updated space | — |
| DELETE | /audio-spaces/{id} | deleteAudioSpace (L390) | apikey+token | host/admin | — | ends space (`is_active=false`, `ended_at`) | — |
| POST | /audio-spaces/{id}/join | joinAudioSpace (L445) | apikey+token | any | — | participant row (listener/requested) | 🧪 |
| POST | /audio-spaces/{id}/leave | leaveAudioSpace (L516) | apikey+token | participant | — | `is_left=true` | — |
| POST | /audio-spaces/{id}/participants/{userId}/type | changeParticipantType (L571) | apikey+token | host/admin | `type` (host/listener/requested/kicked_out…) | updated participant | — |
| POST | /audio-spaces/{id}/participants/{userId}/mic | toggleParticipantMic (L646) | apikey+token | host/admin or self | `mic_status` (on/muted) | updated participant | — |
| POST | /audio-spaces/{id}/participants/{userId}/kick | kickParticipant (L723) | apikey+token | host/admin | — | participant → kicked_out | — |
| GET | /audio-spaces/{id}/messages | getMessages (L787) | apikey+token | any | — | `data:[audio_space_messages]` | — |
| POST | /audio-spaces/{id}/messages | sendMessage (L854) | apikey+token | participant | `content` | created message | 🧪 |

## 6. User & profile (legacy family — apikey only)

| METHOD | Path | Controller@method | Auth | Roles | Request fields | Response summary | used-by |
|---|---|---|---|---|---|---|---|
| POST | /editProfile | UserController@editProfile (L661) | apikey | — | `my_user_id`, `full_name?`, `bio?`, `interests?`, `profile?` (file), `background?` (file) | `data:{user}` | 📱 |
| POST | /followUser | followUser (L735) | apikey | — | `my_user_id`, `user_id` | increments counters, `saved_notifications` row + push | 📱 |
| POST | /unfollowUser | unfollowUser (L874) | apikey | — | `my_user_id`, `user_id` | decrements counters | 📱 |
| POST | /fetchFollowingList | fetchFollowingList (L810) | apikey | — | `my_user_id`, `start`, `limit` | `data:[users]` | 📱 |
| POST | /fetchFollowersList | fetchFollowersList (L831) | apikey | — | `my_user_id`, `start`, `limit` | `data:[users]` | 📱 |
| POST | /searchFollower | searchFollower | apikey | — | `my_user_id`, `search` | `data:[users]` | 📱 |
| POST | /checkUsername | checkUsername (L926) | apikey | — | `username` | availability vs `username_restrictions` | 📱 |
| POST | /fetchRandomProfile | fetchRandomProfile (L942) | apikey | — | `my_user_id`, `start`, `limit` | `data:[users]` | 📱 |
| POST | /reportUser | reportUser (L1074) | apikey | — | `my_user_id`, `user_id`, `reason`, `desc?` | `reports` row | 📱 |
| POST | /fetchBlockedUserList | fetchBlockedUserList (L1459) | apikey | — | `my_user_id` | `data:[users]` | 📱 |
| POST | /UserBlockedByUser | UserBlockedByUser (L1561) | apikey | — | `my_user_id`, `user_id` | appends to `block_user_ids` CSV | 📱 |
| POST | /UserUnblockedByUser | UserUnblockedByUser (L1642) | apikey | — | `my_user_id`, `user_id` | removes from CSV | 📱 |
| POST | /fetchPostByUser | fetchPostByUser (L1167) | apikey | — | `my_user_id`, `user_id`, `start`, `limit` | `data:[posts]` | 📱 |
| POST | /fetchProfile | fetchProfile (L1216) | apikey | — | `my_user_id`, `user_id` | `data:{user, counts, is_following}` | 📱 |
| POST | /searchProfile | searchProfile (L1409) | apikey | — | `my_user_id`, `search`, `start`, `limit` | `data:[users]` | 📱 |
| POST | /fetchUserNotification | fetchUserNotification (L1687) | apikey | — | `my_user_id`, `start`, `limit` | `data:[saved_notifications w/ user,post,room,reel]` | 📱 |
| POST | /profileVerification | ProfileVerificationController@profileVerification (L18) | apikey | — | `user_id`, `full_name`, `document_type`, `document` (file), `selfie` (file) | creates `profile_verifications`, `is_verified=1` (pending) | 📱 |

### Moderator (`/api/Moderator/*` — apikey only; inline `is_moderator` check on `user_id`)

Routes api.php L88–96. All in `UserController.php`.

| METHOD | Path | Controller@method | Request fields | Response summary | used-by |
|---|---|---|---|---|---|
| POST | /Moderator/deletePostByModerator | deletePostByModerator (L1743) | `user_id` (moderator), `post_id` | deletes post + contents + comments + likes + reports | 📱 |
| POST | /Moderator/deleteCommentByModerator | deleteCommentByModerator (L1788) | `user_id`, `comment_id` | deletes comment | 📱 |
| POST | /Moderator/deleteRoomByModerator | deleteRoomByModerator (L1835) | `user_id`, `room_id` | deletes room + members | 📱 |
| POST | /Moderator/deleteStoryByModerator | deleteStoryByModerator (L1874) | `user_id`, `story_id` | deletes story | 📱 |
| POST | /Moderator/userBlockByModerator | userBlockByModerator (L1910) | `user_id`, `block_user_id` | sets `is_block=1` | 📱 |
| POST | /Moderator/deleteReelCommentByModerator | deleteReelCommentByModerator (L1957) | `user_id`, `comment_id` | deletes reel comment | 📱 |
| POST | /Moderator/deleteReelByModerator | deleteReelByModerator (L2004) | `user_id`, `reel_id` | deletes reel | 📱 |

## 7. Posts, comments, stories (apikey only) — `PostController.php`

| METHOD | Path | Controller@method | Request fields (verified from validators) | Response summary | used-by |
|---|---|---|---|---|---|
| POST | /addPost | addPost (L85) | `my_user_id`, `desc?`, `interest_ids?`, media files, hashtag strings | `data:{post+contents}` | 📱 |
| POST | /fetchPosts | fetchPosts (L159) | `my_user_id`, `type` (0 random / 1 latest), `start`, `limit` | `data:[posts]` | 📱 |
| POST | /addComment | addComment (L220) | `my_user_id`, `post_id`, `comment` | `data:{comment}` + notification | 📱 |
| POST | /fetchComments | fetchComments (L294) | `post_id`, `start`, `limit` | `data:[comments]` | 📱 |
| POST | /deleteComment | deleteComment (L330) | `my_user_id`, `comment_id` | owner-only delete | 📱 |
| POST | /likePost | likePost (L372) | `my_user_id`, `post_id`, `reaction_type?` | likes_count++, `likes` row | 📱 |
| POST | /dislikePost | dislikePost (L461) | `my_user_id`, `post_id` | removes like | 📱 |
| POST | /reportPost | reportPost (L600) | `my_user_id`, `post_id`, `reason`, `desc?` | `reports` row | 📱 |
| POST | /deleteMyPost | deleteMyPost (L652) | `my_user_id`, `post_id` | deletes post + media files | 📱 |
| POST | /fetchPostByPostId | fetchPostByPostId (L1213) | `my_user_id`, `post_id` | `data:{post}` | 📱 |
| POST | /fetchPostsByHashtag | fetchPostsByHashtag (L1170) | `hashtag`, `start`, `limit` | `data:[posts]` | 📱 |
| POST | /createStory | createStory (L695) | `my_user_id`, media file | `data:{story}` | 📱 |
| POST | /viewStory | viewStory (L734) | `my_user_id`, `story_id` | records view | 📱 |
| POST | /fetchStory | fetchStory (L788) | `my_user_id`, `start`, `limit` | grouped stories by user | 📱 |
| POST | /fetchStoryByID | fetchStoryByID | `story_id` | `data:{story}` | 📱 |
| POST | /deleteStory | deleteStory (L1417) | `my_user_id`, `story_id` | deletes story | 📱 |
| POST | /uploadFile | uploadFile (L824) | multipart `uploadFile` (required) | `data:"<storage url>"` | 📱 |
| POST | /fetchUsersWhoLikedPost | fetchUsersWhoLikedPost (L849) | `post_id`, `start`, `limit` | `data:[users]` | 📱 |
| POST | /searchHashtag | searchHashtag (L888) | `search` | `data:[hashtags]` | 📱 |
| POST | /searchPost | searchPost (L945) | `my_user_id`, `search`, `start`, `limit` | `data:[posts]` | 📱 |
| POST | /likeDislikeComment | likeDislikeComment (L998) | `my_user_id`, `comment_id` | toggles `like_comments` | 📱 |
| POST | /searchPostByInterestId | searchPostByInterestId (L1053) | `interest_id`, `start`, `limit` | `data:[posts]` | 📱 |
| POST | /test | test (L1788) | — | debug echo | — (DEAD_CODE) |

## 8. Reels & music (apikey only) — `ReelController.php`

| METHOD | Path | Controller@method | Request fields | used-by |
|---|---|---|---|---|
| POST | /uploadReel | uploadReel (L148) | `my_user_id`, `reel` (video file), `desc?`, `interest_ids?`, `cause_id?`, `music_id?` | 📱 |
| POST | /likeDislikeReel | likeDislikeReel (L193) | `my_user_id`, `reel_id` | 📱 |
| POST | /increaseReelViewCount | increaseReelViewCount (L274) | `reel_id` | 📱 |
| POST | /addReelComment | addReelComment (L300) | `my_user_id`, `reel_id`, `comment` | 📱 |
| POST | /fetchReelComments | fetchReelComments (L364) | `reel_id`, `start`, `limit` | 📱 |
| POST | /deleteReelComment | deleteReelComment (L402) | `my_user_id`, `comment_id` | 📱 |
| POST | /deleteReel | deleteReel (L551) | `my_user_id`, `reel_id` | 📱 |
| POST | /fetchReelsByUserId | fetchReelsByUserId (L444) | `my_user_id`, `user_id`, `start`, `limit` | 📱 |
| POST | /fetchReelsOnExplore | fetchReelsOnExplore (L499) | `my_user_id`, `type` (0 following / 1 forYou), `start`, `limit` | 📱 |
| POST | /searchReelsByInterestId | searchReelsByInterestId (L606) | `interest_id`, `start`, `limit` | 📱 |
| POST | /fetchReelsByHashtag | fetchReelsByHashtag (L669) | `hashtag`, `start`, `limit` | 📱 |
| POST | /reportReel | reportReel (L716) | `my_user_id`, `reel_id`, `reason`, `desc?` | 📱 |
| POST | /fetchSavedReels | fetchSavedReels (L756) | `my_user_id`, `start`, `limit` | 📱 |
| POST | /fetchReelById | fetchReelById (L795) | `my_user_id`, `reel_id` | 📱 |
| POST | /fetchMusicWithSearch | fetchMusicWithSearch (L22) | `search?`, `start`, `limit` | 📱 |
| POST | /fetchMusicCategories | fetchMusicCategories (L51) | — | 📱 |
| POST | /fetchSavedMusic | fetchSavedMusic (L65) | `my_user_id`, `start`, `limit` | 📱 |
| POST | /fetchMusicByCategory | fetchMusicByCategory (L90) | `category_id`, `start`, `limit` | 📱 |
| POST | /fetchReelsByMusic | fetchReelsByMusic (L118) | `music_id`, `start`, `limit` | 📱 |

## 9. Rooms (apikey only) — `RoomController.php`

| METHOD | Path | Controller@method | Request fields | used-by |
|---|---|---|---|---|
| POST | /createRoom | createRoom (L21) | `my_user_id`, `title`, `desc`, `photo?` (file), `interest_ids`, `is_private?`, `is_join_request_enable?` | 📱 |
| POST | /editRoom | editRoom (L100) | `room_id`, `my_user_id` (admin only), partial fields | 📱 |
| POST | /inviteUserToRoom | inviteUserToRoom (L144) | `my_user_id`, `room_id`, `user_id[]` | 📱 |
| POST | /joinOrRequestRoom | joinOrRequestRoom (L246) | `my_user_id`, `room_id` | 📱 |
| POST | /getInvitationList | getInvitationList (L403) | `my_user_id` | 📱 |
| POST | /acceptInvitation | acceptInvitation (L432) | `my_user_id`, `room_id` | 📱 |
| POST | /acceptRoomRequest | acceptRoomRequest (L534) | `my_user_id` (admin), `user_id`, `room_id` | 📱 |
| POST | /rejectInvitation | rejectInvitation (L654) | `my_user_id`, `room_id` | 📱 |
| POST | /fetchRoomRequestList | fetchRoomRequestList (L769) | `my_user_id`, `room_id` | 📱 |
| POST | /rejectRoomRequest | rejectRoomRequest (L714) | `my_user_id` (admin), `user_id`, `room_id` | 📱 |
| POST | /removeUserFromRoom | removeUserFromRoom (L840) | `my_user_id` (admin), `user_id`, `room_id` | 📱 |
| POST | /makeRoomAdmin | makeRoomAdmin (L1584) | `my_user_id` (owner), `user_id`, `room_id` | 📱 |
| POST | /fetchRoomUsersList | fetchRoomUsersList (L799) | `room_id`, `my_user_id` | 📱 |
| POST | /reportRoom | reportRoom (L974) | `my_user_id`, `room_id`, `reason`, `desc?` | 📱 |
| POST | /leaveThisRoom | leaveThisRoom (L1083) | `my_user_id`, `room_id` | 📱 |
| POST | /fetchRoomDetail | fetchRoomDetail (L1148) | `room_id`, `my_user_id` | 📱 |
| POST | /deleteRoom | deleteRoom (L1241) | `my_user_id` (owner), `room_id` | 📱 |
| POST | /fetchMyOwnRooms | fetchMyOwnRooms (L1284) | `my_user_id`, `start`, `limit` | 📱 |
| POST | /editRoom (above) | — | — | — |
| POST | /fetchSuggestedRooms | fetchSuggestedRooms (L1346) | `my_user_id` | — (not in mobile list) |
| POST | /fetchRoomsByInterest | fetchRoomsByInterest (L1302) | `my_user_id`, `interest_id`, `start`, `limit` | 📱 |
| POST | /searchUserForInvitation | searchUserForInvitation (L1463) | `my_user_id`, `room_id`, `search` | 📱 |
| POST | /fetchRandomRooms | fetchRandomRooms (L1529) | `my_user_id`, `start`, `limit` | 📱 |
| POST | /fetchRoomAdmins | fetchRoomAdmins (L1623) | `room_id` | 📱 |
| POST | /removeAdminFromRoom | removeAdminFromRoom (L1650) | `my_user_id` (owner), `user_id`, `room_id` | 📱 |
| POST | /fetchRoomsList | fetchRoomsList (L1689) | `my_user_id`, `start`, `limit` | — |
| POST | /muteUnmuteRoomNotification | muteUnmuteRoomNotification (L2259) | `my_user_id`, `room_id` | 📱 |
| POST | /fetchRoomsIAmIn | fetchRoomsIAmIn (L2298) | `my_user_id` | 📱 |

## 10. Interests, settings, misc (apikey only)

| METHOD | Path | Controller@method | Request fields | Response summary | used-by |
|---|---|---|---|---|---|
| POST | /fetchInterests | InterestController@fetchInterests (InterestController.php L144) | — | `data:[interests]` | 📱 |
| POST | /fetchSetting | SettingsController@fetchSetting (SettingsController.php L188) | — | `data:{settings + interests(+totalRoomOfInterest), documentType, reportReasons, restrictedUsernames}` | 📱 |
| POST | /pushNotificationToSingleUser | pushNotificationToSingleUser (L701) | full FCM v1 JSON body | relays to FCM with OAuth token | 📱 |
| POST | /generateAgoraToken | generateAgoraToken (L736) | `channelName` | `data:{token}` (7200s publisher) | 📱 |
| POST | /fetchPlatformNotification | AdminController@fetchPlatformNotification (AdminController.php L212) | `start`, `limit` | `data:[admin_notifications]` | 📱 |
| POST | /fetchFAQs | FAQsController@fetchFAQs (FAQsController.php L11) | `type?` | `data:[faqs]` | 📱 |

## 11. Causes & donations (apikey only; NOT auth-token) — verified by `API_TEST_RESULTS.md`

| METHOD | Path | Controller@method | Request fields | Response summary | used-by |
|---|---|---|---|---|---|
| POST | /createCause | CauseController@createCause (CauseController.php L18) | `user_id`, `title`, `description`, `goal_amount` (≥100), `deadline?`, `category_id`, `media?[]` (URLs) | `data:{post type=cause, is_verified=0}` | 🧪 |
| POST | /fetchCauses | fetchCauses (L89) | `start`/`offset`, `limit` | `data:[causes + progress_percentage, follower_count, donation_count]` | 🧪 |
| POST | /fetchCauseById | fetchCauseById (L134) | `my_user_id?`, `cause_id` | `data:{cause, user, category, is_following, follower_count}` | 🧪 |
| POST | /followCause | followCause (L183) | `user_id`, `cause_id` | `cause_followers` row | 🧪 |
| POST | /unfollowCause | unfollowCause (L232) | `user_id`, `cause_id` | removes row | 🧪 |
| POST | /fetchMyCauses | fetchMyCauses (L274) | `user_id`, `start`, `limit` | `data:[followed causes]` | 🧪 |
| POST | /fetchCauseCategories | fetchCategories (L307) | — | `data:[cause_categories]` | 🧪 |
| POST | /createDonationOrder | DonationController@createDonationOrder (DonationController.php L39) | `user_id`, `cause_id`, `amount` (INR), `notes?` | `data:{donation_id, order_id, amount, currency:INR, razorpay_key}` | 🧪 |
| POST | /verifyDonation | verifyDonation (L133) | `donation_id`, `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` | success → `posts.raised_amount++`, charity card sync; `data:{donation}` | 🧪 |
| POST | /fetchMyDonations | fetchMyDonations (L228) | `user_id`, `limit?`, `start`/`offset` | `data:{donations, total_donated, donation_count}` | 🧪 |
| POST | /fetchCauseDonations | fetchCauseDonations (L270) | `cause_id`, `limit?`, `start`/`offset`, `sort_by?`, `sort_direction?` | `data:{donations, total_raised, donation_count}` | 🧪 |
| POST | /razorpay/webhook | handleWebhook (L332) | Razorpay event payload; header `X-Razorpay-Signature` | **No middleware** (route api.php L211); updates donation status | external (Razorpay) |

## 12. Volunteer & supporter (apikey + token; admin part `IsAdmin`)

Routes api.php L278–324.

| METHOD | Path | Controller@method | Auth | Request fields | Response summary | used-by |
|---|---|---|---|---|---|---|
| POST | /user/select-type | UserController@selectUserType (UserController.php L2109) | apikey+token | `user_type` (supporter\|volunteer) — one-time | `data:{user}` | — |
| POST | /volunteer/apply | VolunteerApplicationController@apply (VolunteerApplicationController.php L15) | apikey+token | `skills[]` (req), `custom_skills?[]`, `availability{}` (req), `is_flexible?`, `city` (req), `state` (req), `country?`, `postal_code?`, `latitude?`, `longitude?`, `service_areas?[]`, `willing_to_travel?`, `max_travel_distance?`, `remote_volunteering?`, `motivation` (req, ≤500), `prior_experience?`, `emergency_contact?`, `emergency_phone?`, `address_line1?`, `address_line2?` | `data:{volunteer_application}` (201) | — |
| GET | /volunteer/status | status (L129) | apikey+token | — | `data:{application}` | — |
| GET | /admin/volunteer/applications | listApplications (L183) | apikey+token+IsAdmin | query filters | `data:[applications]` | — |
| POST | /admin/volunteer/applications/{id}/approve | approve (L212) | apikey+token+IsAdmin | `admin_notes?` | sets application approved + `users.volunteer_status='approved'` + push | — |
| POST | /admin/volunteer/applications/{id}/reject | reject (L301) | apikey+token+IsAdmin | `rejection_reason` | sets rejected + push | — |

## 13. Charity Profile V2 (`/api/charity/*` — apikey + token)

Routes api.php L329–354. Source controllers: `CharityCardController`, `DonationPointsController`, `AchievementsController`, `DonationGoalsController`, `CharityEventsController`.

| METHOD | Path | Controller@method | Request fields | Response summary | used-by |
|---|---|---|---|---|---|
| GET | /charity/card/my-card | CharityCardController@getMyCard (L28) | — | `data:{card}` (auto-created via `CharityCardService::syncCardStats`) | — |
| GET | /charity/card | getMyCard (alias, route api.php L348) | — | same | — |
| GET | /charity/card/tier-info | getTierInfo (L71) | — | tier thresholds + current level | — |
| POST | /charity/card/verify | verifyCard (L144) | `card_number` | validates & marks verified | — |
| POST | /charity/card/share | shareCard (L197) | — | marks shared / returns share payload | — |
| GET | /charity/card/stats | getCardStats (L235) | — | totals (also used by /charity/impact) | — |
| GET | /charity/impact | getCardStats (alias, route api.php L354) | — | same | — |
| GET | /charity/points/balance | DonationPointsController@getBalance (L20) | — | `data:{balance, expiring_soon}` | — |
| GET | /charity/points/history | getHistory (L59) | query `start`,`limit` | `data:[donation_points]` | — |
| GET | /charity/points/expiring | getExpiringPoints (L110) | query `days?` | `data:[points]` | — |
| POST | /charity/points/redeem | redeemPoints (L155) | `points` | negative ledger row | — |
| GET | /charity/points/summary | getSummary (L218) | — | earned/redeemed/expired totals | — |
| GET | /charity/achievements/all | AchievementsController@getAllAchievements (L20) | — | `data:[achievements]` | — |
| GET | /charity/achievements/my-achievements | getMyAchievements (L67) | — | `data:[user_achievements + achievement]` | — |
| POST | /charity/achievements/claim | claimAchievement (L143) | `achievement_id` | claims + awards `reward_points` | — |
| GET | /charity/achievements/progress | getProgress (L202) | — | progress vs thresholds | — |
| GET | /charity/achievements/summary | getSummary (L253) | — | counts by tier/category | — |
| GET | /charity/goals/my-goals | DonationGoalsController@getMyGoals (L19) | — | `data:[donation_goals]` | — |
| POST | /charity/goals/create | createGoal (L73) | `title`, `target_amount`, `start_date`, `end_date`, `description?`, `frequency?`, `is_public?` | `data:{goal}` | — |
| POST | /charity/goals/update | updateGoal (L131) | `goal_id`, partial fields | updated goal | — |
| POST | /charity/goals/delete | deleteGoal (L197) | `goal_id` | deletes | — |
| POST | /charity/goals/complete | completeGoal (L237) | `goal_id` | status completed | — |
| GET | /charity/goals/summary | getSummary (L286) | — | totals | — |
| GET | /charity/events/all | CharityEventsController@getAllEvents (L20) | query `type?`,`status?` | `data:[charity_events]` | — |
| GET | /charity/events | getAllEvents (mobile-alias, route api.php L351) | — | same | — |
| GET | /charity/events/details | getEventDetails (L72) | query `event_id` | `data:{event, participants_count}` | — |
| POST | /charity/events/register | registerForEvent (L117) | `event_id` | `event_participants` row | — |
| POST | /charity/events/check-in | checkInToEvent (L189) | `event_id`, `qr_code` | attended + points | — |
| GET | /charity/events/my-events | getMyEvents (L251) | — | `data:[registrations]` | — |
| POST | /charity/events/cancel | cancelRegistration (L294) | `event_id` | status cancelled | — |

---

## 14. Web routes (admin panel, `routes/web.php` — 133 routes, session `checkLogin` unless noted)

Public (no auth): `GET /s/{shareLinkPage}` (ShareLinkPageController@shareLinkPage, web.php L31), `GET /.well-known/apple-app-site-association` & `assetlinks.json` (L33–54), `GET /` (login form), `POST loginForm`, `POST forgotPasswordForm`, `GET privacyPolicy`, `GET termsOfUse`, `POST androidDeepLinking`, `POST iOSDeepLinking`, `GET deleteStoryFromWeb`, `GET fetchAllChartData`, `GET fetchCommentsInReelModal`.

Authenticated groups (all `checkLogin`):

| Group | Routes (paths) | Controller |
|---|---|---|
| Dashboard/settings | `index`, `setting`, `updateSettings`, `changeAppName`, `admob`, `admobAndroid`, `admobiOS`, `addFakeData` | SettingsController (L76, L461, L763) |
| Document types | `addDocumentType`, `documentTypeList`, `updateDocumentType/{id}`, `deleteDocumentType/{id}` | SettingsController (L221–325) |
| Report reasons | `addreportReason`, `reportReasonList`, `updateReportReason/{id}`, `deleteReportReasonType` | SettingsController (L343–445) |
| Notifications | `notification`, `sendNotification`, `adminNotificationList`, `updateNotification`, `repeatNotification`, `deleteNotification` | AdminController (L72–150) |
| Users | `users`, `userListWeb`, `verifiedUserList`, `verifiedUserBySubscriptionList`, `usersDetail/{id}`, `verifyUser`, `userPostsList`, `deletePostFromUserPostTable`, `editProfileFormWeb`, `updateModeratorStatus`, `deleteAvatarFromUserDetail`, `deleteProfileFromUserDetail`, `moderatorsList`, `blockUserByAdmin/{id}`, `unblockUserByAdmin/{id}` | UserController (L29–2085) |
| User reports | `userReportList`, `deleteUserReport`, `blockUserFromReport` | UserController (L1004–1141) |
| Rooms | `rooms`, `roomsListWeb`, `deleteThisRoom`, `roomDetails/{id}`, `updatePrivateStatus`, `updateJoinRequestStatus`, `allRoomUsersListTableWeb`, `roomMembersListTableWeb`, `roomCoAdminTableWeb`, `userRoomsOwnTable`, `userRoomInTable` | RoomController (L1715–2231) |
| Room reports | `reports`, `reportList`, `deleteReport`, `deleteReportWithRoom` | RoomController (L893–1056) |
| Interests | `interests`, `addInterest`, `interestList`, `updateInterest`, `deleteInterest/{id}` | InterestController (L11–126) |
| Pages | `viewPrivacy`, `updatePrivacy`, `addContentForm`, `addTermsForm`, `updateTerms`, `viewTerms` | PagesController (L55–72) |
| Posts moderation | `viewPosts`, `reportPostList`, `deletePostReport`, `deletePost`, `allPostsList`, `updatePostRestrictionStatus`, `fetchPostComment`, `deleteCommentFromAdmin`, `viewStories`, `userStoryList`, `allStoriesList`, `deleteStoryFromAdmin` | PostController (L510–1703) |
| Reels moderation | `viewReels`, `reelList`, `deleteReelCommentFromAdmin`, `deleteReelByAdmin`, `userReelList`, `reelReportList`, `deleteReelReport`, `deleteReelFromReport` | ReelController (L827–1276) |
| Music | `musics`, `categoryList`, `addCategory`, `updateCategory`, `deleteCategory`, `musicList`, `addMusic`, `updateMusic`, `deleteMusic` | ReelController (L1321–1562) |
| Verification | `verificationRequests`, `profileVerificationList`, `approvedProfileVerification/{id}`, `rejectProfileVerification/{id}` | ProfileVerificationController (L13–181) |
| Volunteer apps | `volunteerApplications`, `volunteerApplicationsList`, `volunteerApplication/{id}`, `volunteerApplication/{id}/approve`, `volunteerApplication/{id}/reject` | VolunteerApplicationController (L394–497) |
| FAQs | `faqs`, `faqsList`, `addFAQsType`, `updateFAQsType`, `deleteFAQsType`, `faqsTypeList`, `addFAQs`, `updateFAQs`, `deleteFAQs` | FAQsController (L11–250) |
| Restrictions | `restrictions`, `usernameRestrictionsList`, `addUsernameRestrict`, `updateUsernameRestrict`, `deleteUsernameRestrictions` | RestrictionController (L12–126) |

---

## 15. Mobile cross-check result (Flutter `../mobile/lib`)

- **97 unique legacy endpoints** referenced from `mobile/lib/utilities/web_service.dart` + `mobile/lib/common/api_service/*` (list extracted from all `apiURL` constants). All are in modules 2, 6–10 above. **None** of the V2 families (`/auth/*`, `/chat/*`, `/notifications/*`, `/audio-spaces/*`, `/charity/*`, `/volunteer/*`, `/user/select-type`, causes, donations) appear in the Flutter lib.
- Mobile sends **only** `apikey` header (`mobile/lib/common/api_service/api_service.dart` L25, `new_api_service.dart` L24) — confirming the app never authenticates via Sanctum against the legacy API.
- External mobile-side integration not in PHP repo: SightEngine moderation (`mobile/lib/common/api_service/sight_engine_service.dart` L28/79/117 → `api.sightengine.com`).
- **Endpoint totals: 187 API (86 mobile-used / 101 not referenced by mobile) + 133 web.**
