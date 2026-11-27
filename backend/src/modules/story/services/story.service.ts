/**
 * Story service — 24h stories business flow. Depends on the repository
 * contract and emits the legacy log events with the legacy logger child name.
 * The actor is ALWAYS the session user — ids never come from the body.
 */
import { logger } from "@/lib/logger";
import { ApiError, type Session } from "@/lib/session";
import { paged } from "@/lib/community/serializers";
import type { StoryRepository, StoryWire, StoryListPage, StoryRequest } from "../repositories/story.repository.interface";

const log = logger.child("stories");

/** Legacy :id path-param handling — reject missing ids early, exact message. */
function requireStoryId(raw: string): string {
  const id = String(raw ?? "").trim();
  if (!id) throw new ApiError("Story id is required", 400);
  return id;
}

export interface StoryFiles {
  content: File | null;
  thumbnail: File | null;
}

export class StoryService {
  constructor(private readonly storyRepository: StoryRepository) {}

  /** GET /api/stories — followed users' last-24h stories (legacy fetchStory). */
  async list(session: Session, page: number, limit: number, skip: number): Promise<StoryListPage> {
    const { items, total } = await this.storyRepository.list(session.userId, skip, limit);
    return paged(items, page, limit, total) as StoryListPage;
  }

  /** POST /api/stories — multipart content + optional thumbnail (legacy createStory). */
  async create(
    req: StoryRequest,
    session: Session,
    data: { type: number; duration: number; content: string | null },
    files: StoryFiles
  ): Promise<StoryWire> {
    const story = await this.storyRepository.create(
      req,
      { id: session.userId, name: session.name },
      {
        type: data.type,
        duration: data.duration,
        content: data.content,
      },
      { content: files.content, thumbnail: files.thumbnail }
    );
    log.info("story_created", {
      storyId: story.id,
      actor: session.userId,
      type: data.type,
      hasThumbnail: files.thumbnail != null,
    });
    return story;
  }

  /** POST /api/stories/:id/view — mark viewed (legacy viewStory). */
  async view(session: Session, rawId: string): Promise<StoryWire> {
    const storyId = requireStoryId(rawId);
    const story = await this.storyRepository.view(session.userId, storyId);
    log.info("story_viewed", { storyId: story.id, actor: session.userId });
    return story;
  }

  /** GET /api/stories/:id (legacy fetchStoryByID). */
  async get(rawId: string): Promise<StoryWire> {
    const storyId = requireStoryId(rawId);
    return this.storyRepository.getById(storyId);
  }

  /** DELETE /api/stories/:id — owner OR moderator (deleteStory + deleteStoryByModerator). */
  async remove(session: Session, rawId: string): Promise<StoryWire> {
    const storyId = requireStoryId(rawId);
    const story = await this.storyRepository.remove(session.userId, session.role, storyId);
    log.info("story_deleted", { storyId: story.id, actor: session.userId });
    return story;
  }

  /** PATCH /api/stories/:id — edit metadata (owner or moderator). */
  async update(
    session: Session,
    rawId: string,
    patch: {
      type?: number;
      duration?: number;
      content?: string;
      thumbnail?: string;
    }
  ): Promise<StoryWire> {
    const storyId = requireStoryId(rawId);
    const story = await this.storyRepository.update(session.userId, session.role, storyId, patch);
    log.info("story_updated", {
      storyId,
      actor: session.userId,
      fields: Object.entries(patch)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k),
    });
    return story;
  }
}
