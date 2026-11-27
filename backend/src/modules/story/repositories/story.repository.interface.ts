/**
 * Story repository contract — persistence boundary for the stories module.
 *
 * The Prisma access itself lives in the shared domain lib
 * (@/lib/community/stories); this contract adapts it so the service keeps
 * depending on an interface. Row types are the lib's serialized wire shapes.
 */
import type { UpdateStoryInput } from "@/lib/community/stories";

export type StoryRequest = Parameters<typeof import("@/lib/community/posts").saveCommunityUpload>[0];

/** Serialized story wire shape (see serializeStory in the lib). */
export interface StoryWire {
  id: string;
  userId: string;
  type: number;
  duration: number;
  content: string | null;
  thumbnail: string | null;
  viewByUserIds: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: unknown;
}

export interface StoryListPage {
  items: Array<Record<string, unknown> & { stories: unknown[] }>;
  total: number;
}

export interface CreateStoryData {
  type: number;
  duration: number;
  content: string | null;
}

export interface StoryRepository {
  list(meId: string, skip: number, take: number): Promise<StoryListPage>;
  getById(storyId: string): Promise<StoryWire>;
  create(
    req: StoryRequest,
    me: { id: string; name: string },
    input: CreateStoryData,
    files: { content?: File | null; thumbnail?: File | null }
  ): Promise<StoryWire>;
  view(meId: string, storyId: string): Promise<StoryWire>;
  remove(meId: string, role: string | undefined, storyId: string): Promise<StoryWire>;
  update(meId: string, role: string | undefined, storyId: string, input: UpdateStoryInput): Promise<StoryWire>;
}
