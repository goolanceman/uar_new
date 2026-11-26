/**
 * Shared community serializers — the single camelCase user shape returned by
 * every generic community router (/api/users social, /api/posts, /api/reels,
 * /api/rooms, /api/chat, /api/audio-spaces, /api/charity). Web and mobile
 * consume the same contract.
 */
import type { User } from "@prisma/client";

/** Prisma select covering every field communityUser() reads. */
export const communityUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  city: true,
  about: true,
  avatar: true,
  username: true,
  backgroundImage: true,
  interestIds: true,
  isPushNotifications: true,
  isInvitedToRoom: true,
  isVerified: true,
  isBlock: true,
  blockUserIds: true,
  savedMusicIds: true,
  savedReelIds: true,
  isModerator: true,
  followingCount: true,
  followersCount: true,
  userType: true,
  volunteerStatus: true,
  totalPoints: true,
  currentTier: true,
  emailVerifiedAt: true,
  loginType: true,
  deviceType: true,
  deviceToken: true,
  createdAt: true,
} as const;

/** Compact author shape for embedding in posts, comments, messages, etc. */
export const communityAuthorSelect = {
  id: true,
  name: true,
  username: true,
  avatar: true,
  isVerified: true,
  role: true,
} as const;

export function csvList(v: string | null | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type CommunityUserRow = Pick<User, keyof typeof communityUserSelect>;
type CommunityAuthorRow = Pick<User, keyof typeof communityAuthorSelect>;
export type { CommunityUserRow, CommunityAuthorRow };

/** Full public profile. Private fields (blocked/saved lists) only for the owner. */
export function communityUser(u: CommunityUserRow, opts: { self?: boolean } = {}) {
  return {
    id: u.id,
    name: u.name,
    username: u.username ?? "",
    email: opts.self ? u.email : undefined,
    phone: opts.self ? u.phone : undefined,
    role: u.role,
    city: u.city,
    about: u.about,
    avatar: u.avatar,
    backgroundImage: u.backgroundImage,
    interestIds: csvList(u.interestIds),
    isVerified: u.isVerified,
    isModerator: u.isModerator === 1,
    isBlocked: u.isBlock === 1,
    followingCount: u.followingCount,
    followersCount: u.followersCount,
    userType: u.userType,
    volunteerStatus: u.volunteerStatus,
    totalPoints: u.totalPoints,
    currentTier: u.currentTier,
    emailVerifiedAt: opts.self ? u.emailVerifiedAt : undefined,
    loginType: opts.self ? u.loginType : undefined,
    deviceType: opts.self ? u.deviceType : undefined,
    deviceToken: opts.self ? u.deviceToken : undefined,
    pushNotifications: u.isPushNotifications === 1,
    roomInvites: u.isInvitedToRoom === 1,
    blockedUserIds: opts.self ? csvList(u.blockUserIds) : undefined,
    savedMusicIds: opts.self ? csvList(u.savedMusicIds) : undefined,
    savedReelIds: opts.self ? csvList(u.savedReelIds) : undefined,
    createdAt: u.createdAt,
  };
}

export function communityAuthor(u: CommunityAuthorRow | null | undefined) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    username: u.username ?? "",
    avatar: u.avatar,
    isVerified: u.isVerified,
    role: u.role,
  };
}

/** Standard paged list envelope for community lists. */
export function paged<T>(items: T[], page: number, limit: number, total?: number) {
  return { items, page, limit, total, hasMore: total !== undefined ? page * limit < total : items.length === limit };
}

/** Parse ?page=&limit= with sane bounds. */
export function pageParams(q: Record<string, unknown>, defLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(q.limit ?? defLimit), 10) || defLimit));
  return { page, limit, skip: (page - 1) * limit };
}
