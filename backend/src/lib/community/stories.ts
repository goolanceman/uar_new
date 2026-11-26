/**
 * Community stories service — 24h stories shared by the generic /api/stories
 * router (web + mobile).
 *
 * Ported from the legacy mobile handlers (src/routes/mobile/posts.ts story
 * routes + Moderator/deleteStoryByModerator) onto the generic contract.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/session";
import { communityAuthor, communityUser } from "@/lib/community/serializers";
import { saveCommunityUpload, isActorModerator } from "@/lib/community/posts";

const STORY_INCLUDE = { user: true } satisfies Prisma.CommunityStoryInclude;

type StoryRow = Prisma.CommunityStoryGetPayload<{ include: typeof STORY_INCLUDE }>;

/** Structural story shape — user optional (feed items embed it separately). */
type StoryLike = Omit<StoryRow, "user"> & { user?: StoryRow["user"] | null };

/** Wire shape for one story (legacy story.dart contract, camelCase). */
export function serializeStory(s: StoryLike, withUser = false) {
  const wire: Record<string, unknown> = {
    id: s.id,
    userId: s.userId,
    type: s.type,
    duration: s.duration,
    content: s.content,
    thumbnail: s.thumbnail,
    viewByUserIds: s.viewByUserIds,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
  if (withUser && s.user) wire.user = communityAuthor(s.user);
  return wire;
}

/** GET /api/stories — followed users' stories from the last 24h (fetchStory). */
export async function listStories(meId: string, skip: number, take: number) {
  const me = await db.user.findUnique({ where: { id: meId } });
  if (!me) throw new ApiError("User not found", 404);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000); // now()->subDay()
  const follows = await db.userFollow.findMany({
    where: { myUserId: me.id, followed: { isBlock: 0 } },
    include: {
      followed: {
        include: { stories: { where: { createdAt: { gte: dayAgo } }, orderBy: { createdAt: "asc" } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const users = follows
    .map((f) => f.followed)
    .filter((u) => u.stories.length > 0)
    .map((u) => ({
      ...communityUser(u),
      stories: u.stories.map((s) => serializeStory(s)),
    }));

  return { items: users.slice(skip, skip + take), total: users.length };
}

/** GET /api/stories/:id (fetchStoryByID). */
export async function getStory(storyId: string) {
  const story = await db.communityStory.findUnique({ where: { id: storyId }, include: STORY_INCLUDE });
  if (!story) throw new ApiError("Story not found", 404);
  return serializeStory(story, true);
}

/** POST /api/stories — multipart (legacy createStory). */
export async function createStory(
  req: Parameters<typeof saveCommunityUpload>[0],
  me: { id: string; name: string },
  input: { type: number; duration: number; content?: string | null },
  files: { content?: File | null; thumbnail?: File | null }
) {
  const content = files.content ? await saveCommunityUpload(req, files.content, me) : input.content ?? null;
  if (!content) throw new ApiError("The content field is required", 400);

  const story = await db.communityStory.create({
    data: {
      userId: me.id,
      type: Math.trunc(input.type), // 0 image | 1 video
      duration: input.duration,
      content,
      thumbnail: files.thumbnail ? await saveCommunityUpload(req, files.thumbnail, me) : null,
    },
    include: STORY_INCLUDE,
  });

  return serializeStory(story);
}

/** POST /api/stories/:id/view — append the viewer id to the CSV (viewStory). */
export async function viewStory(meId: string, storyId: string) {
  const story = await db.communityStory.findUnique({ where: { id: storyId } });
  if (!story) throw new ApiError("Story not found", 404);

  const viewed = (story.viewByUserIds ?? "").split(",").map((s) => s.trim());
  if (viewed.includes(meId)) return serializeStory(story);

  const updated = await db.communityStory.update({
    where: { id: story.id },
    data: { viewByUserIds: `${story.viewByUserIds ?? ""}${meId},` },
  });
  return serializeStory(updated);
}

/** DELETE /api/stories/:id — owner OR moderator (deleteStory + deleteStoryByModerator). */
export async function deleteStory(meId: string, role: string | undefined, storyId: string) {
  const moderator = await isActorModerator(meId, role);
  const story = await db.communityStory.findUnique({ where: { id: storyId } });
  if (!story) throw new ApiError("Story not found", 404);
  if (story.userId !== meId && !moderator) {
    throw new ApiError("You do not have permission for this action", 403);
  }

  await db.communityStory.delete({ where: { id: story.id } });
  return serializeStory(story);
}
