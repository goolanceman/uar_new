/**
 * Story repository implementation — adapts the shared stories domain lib
 * (@/domains/community/stories), which owns ALL Prisma access for this module
 * (read-only shared code; no new Prisma access introduced here). The casts
 * only pin the lib's serialized wire shapes to this module's contracts.
 */
import {
  createStory,
  deleteStory,
  getStory,
  listStories,
  updateStory,
  viewStory,
} from "@/domains/community/stories";
import type {
  CreateStoryData,
  StoryRepository,
  StoryRequest,
  StoryWire,
  StoryListPage,
} from "./story.repository.interface";

export class LibStoryRepository implements StoryRepository {
  async list(meId: string, skip: number, take: number): Promise<StoryListPage> {
    return listStories(meId, skip, take) as unknown as StoryListPage;
  }

  async getById(storyId: string): Promise<StoryWire> {
    return getStory(storyId) as unknown as StoryWire;
  }

  async create(
    req: StoryRequest,
    me: { id: string; name: string },
    input: CreateStoryData,
    files: { content?: File | null; thumbnail?: File | null }
  ): Promise<StoryWire> {
    return createStory(req, me, input, files) as unknown as StoryWire;
  }

  async view(meId: string, storyId: string): Promise<StoryWire> {
    return viewStory(meId, storyId) as unknown as StoryWire;
  }

  async remove(meId: string, role: string | undefined, storyId: string): Promise<StoryWire> {
    return deleteStory(meId, role, storyId) as unknown as StoryWire;
  }

  async update(
    meId: string,
    role: string | undefined,
    storyId: string,
    input: Parameters<typeof updateStory>[3]
  ): Promise<StoryWire> {
    return updateStory(meId, role, storyId, input) as unknown as StoryWire;
  }
}
